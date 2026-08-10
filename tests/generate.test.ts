import { describe, it, expect } from 'vitest'
import { cpSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from '../src/generate.js'
import { MANIFEST_PATH, checkDrift } from '../src/manifest.js'

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
})
