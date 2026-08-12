import { describe, it, expect } from 'vitest'
import { cpSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from '../src/generate.js'
import { bumpVersion, bumpCheck, bumpAudit } from '../src/bump.js'
import { readField } from '../src/field-edit.js'
import { ConfigError } from '../src/config.js'

function freshFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eh-bump-'))
  cpSync('fixtures/kitchen-sink', dir, { recursive: true })
  return dir
}

// A fixture that has already been generated once (manifest present), the
// realistic state a repo is in when someone runs `bump`.
function generatedFixture(): string {
  const dir = freshFixture()
  generate(dir)
  return dir
}

function yaml(dir: string): string {
  return readFileSync(join(dir, 'everyharness.yaml'), 'utf8')
}

function setYaml(dir: string, text: string): void {
  writeFileSync(join(dir, 'everyharness.yaml'), text)
}

describe('bumpVersion', () => {
  it('rejects a non-semver version with a ConfigError carrying the schema wording', () => {
    const dir = generatedFixture()
    try {
      bumpVersion(dir, 'not-a-version')
      expect.unreachable('bumpVersion should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError)
      expect((e as ConfigError).message).toContain('semver, e.g. 1.2.3')
    }
  })

  it('bumps everyharness.yaml, declared files, and regenerated manifests to the new version, preserving yaml comments; audit stays clean', () => {
    const dir = generatedFixture()
    const result = bumpVersion(dir, '9.9.9')

    expect(result.newVersion).toBe('9.9.9')
    expect(result.configOldVersion).toBe('0.1.0')

    // everyharness.yaml: version rewritten, comment preserved
    const text = yaml(dir)
    expect(text).toContain('version: 9.9.9')
    expect(text).toContain('# kitchen-sink: fixture plugin')

    // declared file
    expect(readField(join(dir, 'release.json'), 'version')).toBe('9.9.9')

    // regenerated harness manifests
    expect(readField(join(dir, '.claude-plugin/plugin.json'), 'version')).toBe('9.9.9')
    expect(readField(join(dir, '.claude-plugin/marketplace.json'), 'plugins.0.version')).toBe('9.9.9')

    // one declared bump line, marked bumped
    const declared = result.files.find((f) => f.path === 'release.json')
    expect(declared).toMatchObject({ status: 'bumped', oldVersion: '0.1.0', newVersion: '9.9.9' })

    expect(result.audit.clean).toBe(true)
  })

  it('works end-to-end from a never-generated fixture (no prior manifest)', () => {
    const dir = freshFixture()
    const result = bumpVersion(dir, '9.9.9')
    expect(result.newVersion).toBe('9.9.9')
    expect(readField(join(dir, 'release.json'), 'version')).toBe('9.9.9')
    expect(readField(join(dir, '.claude-plugin/plugin.json'), 'version')).toBe('9.9.9')
    expect(result.audit.clean).toBe(true)
  })

  it('reports SKIP for a declared file that is missing, without failing', () => {
    const dir = generatedFixture()
    setYaml(
      dir,
      yaml(dir).replace(
        '    - { path: release.json, field: version }',
        '    - { path: release.json, field: version }\n    - { path: absent.json, field: version }',
      ),
    )
    const result = bumpVersion(dir, '9.9.9')
    const absent = result.files.find((f) => f.path === 'absent.json')
    expect(absent).toMatchObject({ status: 'skipped' })
    expect(readField(join(dir, 'release.json'), 'version')).toBe('9.9.9')
  })

  it('reports every unreadable declared file before writing anything', () => {
    const dir = generatedFixture()
    // release.json declared with a field that does not exist -> preflight failure
    setYaml(dir, yaml(dir).replace('field: version }', 'field: nope }'))
    const before = readField(join(dir, 'release.json'), 'version')
    try {
      bumpVersion(dir, '9.9.9')
      expect.unreachable('bumpVersion should have thrown on preflight')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError)
      expect((e as ConfigError).message).toContain('nope')
    }
    // nothing was written
    expect(readField(join(dir, 'release.json'), 'version')).toBe(before)
    expect(yaml(dir)).toContain('version: 0.1.0')
  })
})

describe('bump refuses a declared generated file', () => {
  it('bumpVersion rejects everyharness.yaml as a declared bump.files entry', () => {
    const dir = generatedFixture()
    setYaml(
      dir,
      yaml(dir).replace(
        '    - { path: release.json, field: version }',
        '    - { path: release.json, field: version }\n    - { path: everyharness.yaml, field: version }',
      ),
    )
    try {
      bumpVersion(dir, '9.9.9')
      expect.unreachable('bumpVersion should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError)
      expect((e as ConfigError).message).toContain('everyharness.yaml')
    }
  })

  it('bumpVersion rejects a manifest-tracked generated file (package.json)', () => {
    const dir = generatedFixture()
    setYaml(
      dir,
      yaml(dir).replace(
        '    - { path: release.json, field: version }',
        '    - { path: release.json, field: version }\n    - { path: package.json, field: version }',
      ),
    )
    try {
      bumpVersion(dir, '9.9.9')
      expect.unreachable('bumpVersion should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError)
      expect((e as ConfigError).message).toContain('package.json')
    }
  })

  it('bumpCheck rejects everyharness.yaml as a declared bump.files entry', () => {
    const dir = generatedFixture()
    setYaml(
      dir,
      yaml(dir).replace(
        '    - { path: release.json, field: version }',
        '    - { path: release.json, field: version }\n    - { path: everyharness.yaml, field: version }',
      ),
    )
    try {
      bumpCheck(dir)
      expect.unreachable('bumpCheck should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError)
      expect((e as ConfigError).message).toContain('everyharness.yaml')
    }
  })

  it('bumpCheck rejects a manifest-tracked generated file (package.json)', () => {
    const dir = generatedFixture()
    setYaml(
      dir,
      yaml(dir).replace(
        '    - { path: release.json, field: version }',
        '    - { path: release.json, field: version }\n    - { path: package.json, field: version }',
      ),
    )
    try {
      bumpCheck(dir)
      expect.unreachable('bumpCheck should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError)
      expect((e as ConfigError).message).toContain('package.json')
    }
  })

  it('bumpAudit rejects a manifest-tracked generated file (package.json)', () => {
    const dir = generatedFixture()
    setYaml(
      dir,
      yaml(dir).replace(
        '    - { path: release.json, field: version }',
        '    - { path: release.json, field: version }\n    - { path: package.json, field: version }',
      ),
    )
    try {
      bumpAudit(dir)
      expect.unreachable('bumpAudit should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError)
      expect((e as ConfigError).message).toContain('package.json')
    }
  })
})

describe('bumpCheck', () => {
  it('is drift-free on a freshly generated in-sync fixture', () => {
    const dir = generatedFixture()
    const result = bumpCheck(dir)
    expect(result.drift).toBe(false)
    expect(result.configVersion).toBe('0.1.0')
    const declared = result.files.find((f) => f.path === 'release.json')
    expect(declared?.version).toBe('0.1.0')
  })

  it('detects drift when a declared file holds a different version', () => {
    const dir = generatedFixture()
    // A non-generated declared file at a different version isolates the
    // distinct-version branch from generated-file drift.
    writeFileSync(join(dir, 'extra.json'), '{\n  "version": "0.2.0"\n}\n')
    setYaml(
      dir,
      yaml(dir).replace(
        '    - { path: release.json, field: version }',
        '    - { path: release.json, field: version }\n    - { path: extra.json, field: version }',
      ),
    )
    const result = bumpCheck(dir)
    expect(result.drift).toBe(true)
    expect(result.staleGenerated).toEqual([])
  })

  it('reports a missing declared file as drift', () => {
    const dir = generatedFixture()
    setYaml(
      dir,
      yaml(dir).replace(
        '    - { path: release.json, field: version }',
        '    - { path: release.json, field: version }\n    - { path: absent.json, field: version }',
      ),
    )
    const result = bumpCheck(dir)
    expect(result.drift).toBe(true)
    const absent = result.files.find((f) => f.path === 'absent.json')
    expect(absent?.version).toBeUndefined()
  })

  it('reports generated-file drift via checkDrift', () => {
    const dir = generatedFixture()
    writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), '{"tampered": true}\n')
    const result = bumpCheck(dir)
    expect(result.drift).toBe(true)
    expect(result.staleGenerated).toContain('.claude-plugin/plugin.json')
  })
})

describe('bumpAudit', () => {
  it('is clean on a freshly generated fixture (every version hit is declared, generated, or the config)', () => {
    const dir = generatedFixture()
    expect(bumpAudit(dir).clean).toBe(true)
  })

  it('flags an undeclared file containing the version string', () => {
    const dir = generatedFixture()
    writeFileSync(join(dir, 'notes.txt'), 'shipped in 0.1.0\n')
    const result = bumpAudit(dir)
    expect(result.clean).toBe(false)
    expect(result.findings.some((f) => f.path === 'notes.txt')).toBe(true)
  })

  it('honors a bump.audit.exclude pattern', () => {
    const dir = generatedFixture()
    writeFileSync(join(dir, 'notes.txt'), 'shipped in 0.1.0\n')
    setYaml(dir, yaml(dir).replace('exclude: []', 'exclude: ["*.txt"]'))
    expect(bumpAudit(dir).clean).toBe(true)
  })

  it('skips binary files', () => {
    const dir = generatedFixture()
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([0x30, 0x2e, 0x31, 0x00, 0x2e, 0x30]))
    // "0.1" then a null byte: a text scan could match a prefix, but the
    // null-byte sniff must skip the file entirely.
    const result = bumpAudit(dir)
    expect(result.findings.some((f) => f.path === 'blob.bin')).toBe(false)
  })
})
