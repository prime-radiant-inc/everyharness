import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readField, writeField } from '../src/field-edit.js'
import { ConfigError } from '../src/config.js'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'eh-field-edit-'))
}

function fileWith(name: string, content: string): string {
  const path = join(tmp(), name)
  writeFileSync(path, content)
  return path
}

describe('readField / writeField', () => {
  it('round-trips a simple JSON field', () => {
    const j = fileWith('pkg.json', '{\n  "version": "1.0.0"\n}\n')
    writeField(j, 'version', '2.0.0')
    expect(readField(j, 'version')).toBe('2.0.0')
  })

  it('writes JSON with a 2-space indent and a trailing newline', () => {
    const j = fileWith('pkg.json', '{\n  "version": "1.0.0"\n}\n')
    writeField(j, 'version', '2.0.0')
    expect(readFileSync(j, 'utf8')).toBe('{\n  "version": "2.0.0"\n}\n')
  })

  it('writes a dotted array path in JSON (superpowers marketplace.json shape)', () => {
    const j2 = fileWith('marketplace.json', JSON.stringify({ plugins: [{ version: '1.0.0' }] }))
    writeField(j2, 'plugins.0.version', '2.0.0')
    expect(JSON.parse(readFileSync(j2, 'utf8')).plugins[0].version).toBe('2.0.0')
  })

  it('reads a dotted array path in JSON', () => {
    const j2 = fileWith('marketplace.json', JSON.stringify({ plugins: [{ version: '1.0.0' }] }))
    expect(readField(j2, 'plugins.0.version')).toBe('1.0.0')
  })

  it('preserves comments and formatting when writing a YAML field', () => {
    const y = fileWith('everyharness.yaml', '# release version\nversion: 1.0.0\nname: x\n')
    writeField(y, 'version', '2.0.0')
    const text = readFileSync(y, 'utf8')
    expect(text).toContain('# release version')
    expect(text).toContain('version: 2.0.0')
  })

  it('round-trips a dotted array path in YAML', () => {
    const y = fileWith('marketplace.yaml', 'plugins:\n  - version: 1.0.0\n    name: a\n')
    writeField(y, 'plugins.0.version', '2.0.0')
    expect(readField(y, 'plugins.0.version')).toBe('2.0.0')
    expect(readFileSync(y, 'utf8')).toContain('name: a')
  })

  it('treats .yml the same as .yaml', () => {
    const y = fileWith('thing.yml', 'version: 1.0.0\n')
    writeField(y, 'version', '2.0.0')
    expect(readField(y, 'version')).toBe('2.0.0')
  })

  it('throws ConfigError naming the file and field for a missing field path in JSON', () => {
    const j = fileWith('pkg.json', '{"version": "1.0.0"}')
    try {
      readField(j, 'nope.0.deep')
      expect.unreachable('readField should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError)
      expect((e as ConfigError).message).toContain(j)
      expect((e as ConfigError).message).toContain('nope.0.deep')
    }
  })

  it('throws ConfigError for a missing field path in YAML', () => {
    const y = fileWith('thing.yaml', 'version: 1.0.0\n')
    expect(() => readField(y, 'nope.deep')).toThrowError(ConfigError)
  })

  it('throws ConfigError naming the file for an unsupported extension', () => {
    const path = join(tmp(), 'x.toml')
    writeFileSync(path, 'version = "1.0.0"\n')
    try {
      readField(path, 'version')
      expect.unreachable('readField should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError)
      expect((e as ConfigError).message).toContain(path)
    }
  })

  it('throws ConfigError for a non-string value in JSON', () => {
    const j = fileWith('pkg.json', '{"count": 5}')
    expect(() => readField(j, 'count')).toThrowError(ConfigError)
  })

  it('throws ConfigError for a non-string value in YAML', () => {
    const y = fileWith('thing.yaml', 'count: 5\n')
    expect(() => readField(y, 'count')).toThrowError(ConfigError)
  })

  it('throws ConfigError for an unreadable file', () => {
    const missing = join(tmp(), 'missing.json')
    expect(() => readField(missing, 'version')).toThrowError(ConfigError)
  })

  it('throws ConfigError for unparseable JSON', () => {
    const j = fileWith('broken.json', '{ not json')
    expect(() => readField(j, 'version')).toThrowError(ConfigError)
  })

  it('throws ConfigError for unparseable YAML', () => {
    const y = fileWith('broken.yaml', 'name: [unclosed\n')
    expect(() => readField(y, 'version')).toThrowError(ConfigError)
  })

  it('throws ConfigError (not a raw yaml-library error) writing a numeric segment through an existing scalar in YAML', () => {
    const y = fileWith('thing.yaml', 'version: hi\n')
    try {
      writeField(y, 'version.0', 'x')
      expect.unreachable('writeField should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError)
      expect((e as ConfigError).message).toContain(y)
      expect((e as ConfigError).message).toContain('version.0')
    }
  })

  it('throws ConfigError writing a string-keyed segment through an existing scalar in YAML', () => {
    const y = fileWith('thing.yaml', 'version: hi\n')
    expect(() => writeField(y, 'version.sub', 'x')).toThrowError(ConfigError)
  })

  it('throws ConfigError writing to a sequence-rooted YAML document', () => {
    const y = fileWith('thing.yaml', '- a\n- b\n')
    expect(() => writeField(y, 'version', 'x')).toThrowError(ConfigError)
  })

  it('throws ConfigError writing to a scalar-rooted YAML document', () => {
    const y = fileWith('thing.yaml', 'hello\n')
    expect(() => writeField(y, 'version', 'x')).toThrowError(ConfigError)
  })

  it('throws ConfigError instead of auto-vivifying a missing intermediate path in YAML', () => {
    const y = fileWith('thing.yaml', 'version: 1.0.0\n')
    const before = readFileSync(y, 'utf8')
    expect(() => writeField(y, 'a.b.c', 'x')).toThrowError(ConfigError)
    expect(readFileSync(y, 'utf8')).toBe(before)
  })

  it('throws ConfigError instead of auto-vivifying a missing intermediate path in JSON', () => {
    const j = fileWith('pkg.json', '{"version": "1.0.0"}')
    const before = readFileSync(j, 'utf8')
    expect(() => writeField(j, 'a.b.c', 'x')).toThrowError(ConfigError)
    expect(readFileSync(j, 'utf8')).toBe(before)
  })

  it('throws ConfigError instead of null-padding an out-of-bounds array index in YAML', () => {
    const y = fileWith('marketplace.yaml', 'plugins:\n  - a\n  - b\n')
    const before = readFileSync(y, 'utf8')
    expect(() => writeField(y, 'plugins.5', 'x')).toThrowError(ConfigError)
    expect(readFileSync(y, 'utf8')).toBe(before)
  })

  it('throws ConfigError instead of null-padding an out-of-bounds array index in JSON', () => {
    const j = fileWith('marketplace.json', JSON.stringify({ plugins: ['a', 'b'] }))
    const before = readFileSync(j, 'utf8')
    expect(() => writeField(j, 'plugins.5', 'x')).toThrowError(ConfigError)
    expect(readFileSync(j, 'utf8')).toBe(before)
  })
})
