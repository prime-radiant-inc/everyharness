import { describe, it, expect, vi } from 'vitest'
import { cpSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from '../src/generate.js'
import { validate } from '../src/validate.js'

function generatedFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eh-val-'))
  cpSync('fixtures/kitchen-sink', dir, { recursive: true })
  generate(dir)
  return dir
}

describe('validate', () => {
  it('passes on a freshly generated plugin', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = validate(generatedFixture())
    expect(result.drift.clean).toBe(true)
    expect(result.schemaErrors).toEqual([])
    expect(result.ok).toBe(true)
    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('reports drift when a generated file is hand-edited', () => {
    const dir = generatedFixture()
    writeFileSync(join(dir, '.claude-plugin/plugin.json'), '{"name":"tampered"}')
    const result = validate(dir)
    expect(result.ok).toBe(false)
    expect(result.drift.modified).toEqual(['.claude-plugin/plugin.json'])
  })

  it('reports schema violations in generated manifests', () => {
    const dir = generatedFixture()
    // Corrupt plugin.json in a schema-relevant way AND refresh the recorded
    // hash so this test isolates schema checking from drift checking.
    const manifestPath = join(dir, '.claude-plugin/plugin.json')
    const broken = JSON.stringify({ version: '0.1.0' }) + '\n' // missing required "name"
    writeFileSync(manifestPath, broken)
    const recorded = JSON.parse(readFileSync(join(dir, '.everyharness/manifest.json'), 'utf8'))
    recorded.files['.claude-plugin/plugin.json'] = {
      sha256: createHash('sha256').update(broken).digest('hex')
    }
    writeFileSync(join(dir, '.everyharness/manifest.json'), JSON.stringify(recorded))
    const result = validate(dir)
    expect(result.drift.clean).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.schemaErrors.join('\n')).toMatch(/name/)
  })
})
