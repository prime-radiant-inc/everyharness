import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSet, deepMerge } from '../src/fileset.js'
import { saveManifest, checkDrift, MANIFEST_PATH } from '../src/manifest.js'
import { ConfigError } from '../src/config.js'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'eh-manifest-'))
}

describe('writeFileSet', () => {
  it('writes nested files and marks executables', () => {
    const dir = tmp()
    writeFileSet(dir, [
      { path: 'a/b/c.json', content: '{}' },
      { path: 'hooks/session-start', content: '#!/bin/bash\n', executable: true },
    ])
    expect(readFileSync(join(dir, 'a/b/c.json'), 'utf8')).toBe('{}')
    expect(statSync(join(dir, 'hooks/session-start')).mode & 0o111).not.toBe(0)
  })

  it('rejects a relative path that escapes root', () => {
    const dir = tmp()
    expect(() => writeFileSet(dir, [{ path: '../escape.txt', content: 'x' }])).toThrowError(ConfigError)
    expect(() => writeFileSet(dir, [{ path: '../escape.txt', content: 'x' }])).toThrowError(/\.\.\/escape\.txt/)
    expect(existsSync(join(dir, '..', 'escape.txt'))).toBe(false)
  })

  it('rejects an absolute path', () => {
    const dir = tmp()
    expect(() => writeFileSet(dir, [{ path: '/etc/escape.txt', content: 'x' }])).toThrowError(ConfigError)
    expect(() => writeFileSet(dir, [{ path: '/etc/escape.txt', content: 'x' }])).toThrowError(/\/etc\/escape\.txt/)
  })

  it('writes nothing when a later file in the set has a bad path', () => {
    const dir = tmp()
    expect(() =>
      writeFileSet(dir, [
        { path: 'good.txt', content: 'fine' },
        { path: '../escape.txt', content: 'x' },
      ]),
    ).toThrowError(ConfigError)
    expect(existsSync(join(dir, 'good.txt'))).toBe(false)
  })
})

describe('deepMerge', () => {
  it('merges nested objects, replaces arrays and scalars', () => {
    expect(
      deepMerge(
        { a: { b: 1, c: [1, 2] }, d: 'x' },
        { a: { c: [3] }, d: 'y', e: true },
      ),
    ).toEqual({ a: { b: 1, c: [3] }, d: 'y', e: true })
  })
})

describe('manifest + drift', () => {
  const files = [
    { path: 'gen/one.txt', content: 'one' },
    { path: 'gen/two.txt', content: 'two' },
  ]

  it('round-trips a clean generation', () => {
    const dir = tmp()
    writeFileSet(dir, files)
    saveManifest(dir, files, '0.1.0')
    const parsed = JSON.parse(readFileSync(join(dir, MANIFEST_PATH), 'utf8'))
    expect(parsed.schema).toBe(1)
    expect(Object.keys(parsed.files).sort()).toEqual(['gen/one.txt', 'gen/two.txt'])
    expect(parsed.files['gen/one.txt']).toEqual({ sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(checkDrift(dir)).toEqual({ missing: [], modified: [], clean: true })
  })

  it('records the executable bit in manifest entries', () => {
    const dir = tmp()
    const filesWithExec = [
      { path: 'gen/one.txt', content: 'one' },
      { path: 'hooks/session-start', content: '#!/bin/bash\n', executable: true },
    ]
    writeFileSet(dir, filesWithExec)
    saveManifest(dir, filesWithExec, '0.1.0')
    const parsed = JSON.parse(readFileSync(join(dir, MANIFEST_PATH), 'utf8'))
    expect(parsed.files['hooks/session-start']).toEqual({
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      executable: true,
    })
    expect(parsed.files['gen/one.txt']).toEqual({ sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
  })

  it('flags exec-bit changes as drift', () => {
    const dir = tmp()
    const filesWithExec = [
      { path: 'gen/one.txt', content: 'one' },
      { path: 'hooks/session-start', content: '#!/bin/bash\n', executable: true },
    ]
    writeFileSet(dir, filesWithExec)
    saveManifest(dir, filesWithExec, '0.1.0')
    chmodSync(join(dir, 'hooks/session-start'), 0o644)
    chmodSync(join(dir, 'gen/one.txt'), 0o755)
    const report = checkDrift(dir)
    expect(report.clean).toBe(false)
    expect(report.modified.sort()).toEqual(['gen/one.txt', 'hooks/session-start'])
  })

  it('skips exec-bit drift when checkExecBit is false', () => {
    const dir = tmp()
    const files = [{ path: 'hooks/run', content: '#!/bin/bash\n', executable: true }]
    writeFileSet(dir, files)
    saveManifest(dir, files, '0.1.0')
    chmodSync(join(dir, 'hooks/run'), 0o644)
    expect(checkDrift(dir).modified).toEqual(['hooks/run'])
    expect(checkDrift(dir, { checkExecBit: false }).modified).toEqual([])
  })

  it('detects hand-edits and deletions', () => {
    const dir = tmp()
    writeFileSet(dir, files)
    saveManifest(dir, files, '0.1.0')
    writeFileSync(join(dir, 'gen/one.txt'), 'tampered')
    rmSync(join(dir, 'gen/two.txt'))
    const report = checkDrift(dir)
    expect(report.clean).toBe(false)
    expect(report.modified).toEqual(['gen/one.txt'])
    expect(report.missing).toEqual(['gen/two.txt'])
  })

  it('throws when no manifest exists', () => {
    expect(() => checkDrift(tmp())).toThrowError(/no generation manifest/i)
  })

  it('reports a corrupt manifest file as a ConfigError', () => {
    const dir = tmp()
    mkdirSync(join(dir, '.everyharness'), { recursive: true })
    writeFileSync(join(dir, MANIFEST_PATH), 'not json')
    expect(() => checkDrift(dir)).toThrowError(ConfigError)
    expect(() => checkDrift(dir)).toThrowError(/not valid JSON/)
  })

  it('chains the original SyntaxError as .cause for a corrupt manifest file', () => {
    const dir = tmp()
    mkdirSync(join(dir, '.everyharness'), { recursive: true })
    writeFileSync(join(dir, MANIFEST_PATH), 'not json')
    try {
      checkDrift(dir)
      expect.unreachable('checkDrift should have thrown')
    } catch (e) {
      expect((e as ConfigError).cause).toBeInstanceOf(SyntaxError)
    }
  })

  it('reports a manifest with the wrong shape as a ConfigError', () => {
    const dir = tmp()
    mkdirSync(join(dir, '.everyharness'), { recursive: true })
    writeFileSync(join(dir, MANIFEST_PATH), '{"schema":1}')
    expect(() => checkDrift(dir)).toThrowError(ConfigError)
    expect(() => checkDrift(dir)).toThrowError(/unrecognized format/)
  })
})
