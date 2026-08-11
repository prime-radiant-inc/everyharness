import { describe, it, expect } from 'vitest'
import { cpSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from '../src/generate.js'
import { MANIFEST_PATH, checkDrift } from '../src/manifest.js'
import type { HarnessAdapter } from '../src/adapters/index.js'

const fullSupport = {
  skills: 'full',
  commands: 'full',
  agents: 'full',
  hooks: 'full',
  mcp: 'full',
  bootstrap: 'full',
} as const

function freshFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eh-gen-'))
  cpSync('fixtures/kitchen-sink', dir, { recursive: true })
  return dir
}

describe('generate', () => {
  it('writes adapter files and a clean manifest', () => {
    const dir = freshFixture()
    const result = generate(dir)
    expect(result.adaptersRun).toEqual(['claude-code'])
    expect(existsSync(join(dir, '.claude-plugin/plugin.json'))).toBe(true)
    expect(existsSync(join(dir, MANIFEST_PATH))).toBe(true)
    expect(checkDrift(dir).clean).toBe(true)
  })

  it('is idempotent', () => {
    const dir = freshFixture()
    generate(dir)
    const first = readFileSync(join(dir, '.claude-plugin/plugin.json'), 'utf8')
    generate(dir)
    expect(readFileSync(join(dir, '.claude-plugin/plugin.json'), 'utf8')).toBe(first)
    expect(checkDrift(dir).clean).toBe(true)
  })

  it('respects harnesses.exclude', () => {
    const dir = freshFixture()
    const yaml = readFileSync(join(dir, 'everyharness.yaml'), 'utf8')
    const patched = yaml.replace('harnesses:\n', 'harnesses:\n  exclude: [claude-code]\n')
    writeFileSync(join(dir, 'everyharness.yaml'), patched)
    const result = generate(dir)
    expect(result.adaptersRun).toEqual([])
    expect(existsSync(join(dir, '.claude-plugin/plugin.json'))).toBe(false)
  })

  it('snapshots the generated tree for the kitchen-sink fixture', () => {
    const dir = freshFixture()
    const result = generate(dir)
    const tree = [...result.files]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((f) => `=== ${f.path} ===\n${f.content}`)
      .join('\n')
    expect(tree).toMatchSnapshot()
  })

  it('throws a ConfigError naming both adapters when they emit the same path', () => {
    const dir = freshFixture()
    const a: HarnessAdapter = {
      name: 'adapter-a',
      support: fullSupport,
      emit: () => ({ files: [{ path: 'gen/collide.txt', content: 'a' }], warnings: [] }),
    }
    const b: HarnessAdapter = {
      name: 'adapter-b',
      support: fullSupport,
      emit: () => ({ files: [{ path: 'gen/collide.txt', content: 'b' }], warnings: [] }),
    }
    expect(() => generate(dir, [a, b])).toThrowError(/both emit/)
    try {
      generate(dir, [a, b])
    } catch (err) {
      expect((err as Error).message).toContain('adapter-a')
      expect((err as Error).message).toContain('adapter-b')
    }
    expect(existsSync(join(dir, MANIFEST_PATH))).toBe(false)
  })

  it('prefixes warnings with the adapter name', () => {
    const dir = freshFixture()
    const synthetic: HarnessAdapter = {
      name: 'synthetic',
      support: fullSupport,
      emit: () => ({
        files: [{ path: 'gen/x.txt', content: 'x' }],
        warnings: ['thing not supported'],
      }),
    }
    const result = generate(dir, [synthetic])
    expect(result.warnings).toEqual(['[synthetic] thing not supported'])
  })

  it('dedupes identical-content collisions between adapters', () => {
    const dir = freshFixture()
    const file = { path: 'gen/shared.txt', content: 'same', executable: undefined }
    const a = { name: 'adapter-a', support: fullSupport, emit: () => ({ files: [{ ...file }], warnings: [] }) }
    const b = { name: 'adapter-b', support: fullSupport, emit: () => ({ files: [{ ...file }], warnings: [] }) }
    const result = generate(dir, [a, b])
    expect(result.files.filter((f) => f.path === 'gen/shared.txt')).toHaveLength(1)
    expect(result.warnings).toEqual([])
  })

  it('still rejects differing-content collisions', () => {
    const dir = freshFixture()
    const a = { name: 'adapter-a', support: fullSupport, emit: () => ({ files: [{ path: 'gen/x.txt', content: 'one' }], warnings: [] }) }
    const b = { name: 'adapter-b', support: fullSupport, emit: () => ({ files: [{ path: 'gen/x.txt', content: 'two' }], warnings: [] }) }
    expect(() => generate(dir, [a, b])).toThrowError(/both emit/)
  })

  it('rejects an adapter emitting over a source component path', () => {
    const dir = freshFixture()
    const evil = { name: 'evil', support: fullSupport, emit: () => ({ files: [{ path: 'everyharness.yaml', content: 'gotcha' }], warnings: [] }) }
    expect(() => generate(dir, [evil])).toThrowError(/would overwrite source/)
    const evil2 = { name: 'evil2', support: fullSupport, emit: () => ({ files: [{ path: 'skills/greeting/SKILL.md', content: 'x' }], warnings: [] }) }
    expect(() => generate(dir, [evil2])).toThrowError(/would overwrite source/)
  })
})
