import { describe, it, expect } from 'vitest'
import { cpSync, mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
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
    expect(result.adaptersRun).toEqual(['claude-code', 'cursor', 'codex', 'devin', 'kimi', 'gemini', 'agent-plugins-1.0', 'agents-marketplace'])
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
    expect(result.adaptersRun).toEqual(['cursor', 'codex', 'devin', 'kimi', 'gemini', 'agent-plugins-1.0', 'agents-marketplace'])
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

  it('rejects adapter emission over source paths even when components have trailing slashes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-gen-trailing-'))
    writeFileSync(join(dir, 'everyharness.yaml'), [
      'name: test-trailing',
      'version: 1.0.0',
      'description: Test with trailing slashes',
      'components:',
      '  skills: skills/',
      'bootstrap:',
      '  none: true',
    ].join('\n'))
    mkdirSync(join(dir, 'skills'))
    writeFileSync(join(dir, 'skills', 'demo.md'), '# Demo Skill\n')
    const evilAdapter = { name: 'evil', support: fullSupport, emit: () => ({ files: [{ path: 'skills/demo.md', content: 'overwritten' }], warnings: [] }) }
    expect(() => generate(dir, [evilAdapter])).toThrowError(/would overwrite source/)
  })

  it('prunes files dropped from the new generation when unmodified', () => {
    const dir = freshFixture()
    const a = { name: 'a', support: fullSupport, emit: () => ({ files: [{ path: 'gen/old.txt', content: 'v1' }], warnings: [] }) }
    generate(dir, [a])
    const b = { name: 'a', support: fullSupport, emit: () => ({ files: [{ path: 'gen2/new.txt', content: 'v2' }], warnings: [] }) }
    const result = generate(dir, [b])
    expect(result.pruned).toEqual(['gen/old.txt'])
    expect(existsSync(join(dir, 'gen/old.txt'))).toBe(false)
    expect(existsSync(join(dir, 'gen'))).toBe(false) // empty parent removed
    expect(existsSync(join(dir, 'gen2/new.txt'))).toBe(true)
  })

  it('leaves hand-modified stale files and warns', () => {
    const dir = freshFixture()
    const a = { name: 'a', support: fullSupport, emit: () => ({ files: [{ path: 'gen/old.txt', content: 'v1' }], warnings: [] }) }
    generate(dir, [a])
    writeFileSync(join(dir, 'gen/old.txt'), 'edited')
    const result = generate(dir, [{ name: 'a', support: fullSupport, emit: () => ({ files: [], warnings: [] }) }])
    expect(result.pruned).toEqual([])
    expect(result.warnings.join('\n')).toMatch(/stale generated file gen\/old\.txt/)
    expect(existsSync(join(dir, 'gen/old.txt'))).toBe(true)
  })

  it('ignores manifest entries with unsafe paths and warns', () => {
    const dir = freshFixture()
    const synthetic: HarnessAdapter = {
      name: 'synthetic',
      support: fullSupport,
      emit: () => ({ files: [{ path: 'gen/file.txt', content: 'v1' }], warnings: [] }),
    }
    generate(dir, [synthetic])

    // Hand-edit manifest to add an unsafe entry with parent-directory traversal
    const manifestPath = join(dir, MANIFEST_PATH)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.files['../escape.txt'] = {
      sha256: '0000000000000000000000000000000000000000000000000000000000000000',
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

    // Create a file outside the plugin root
    const parentDir = dirname(dir)
    const outsideFile = join(parentDir, 'escape.txt')
    writeFileSync(outsideFile, 'should not be deleted')

    try {
      // Regenerate with empty adapter — should skip the unsafe entry and warn
      const result = generate(dir, [{ name: 'empty', support: fullSupport, emit: () => ({ files: [], warnings: [] }) }])

      expect(existsSync(outsideFile)).toBe(true)
      expect(result.pruned).not.toContain('../escape.txt')
      expect(result.warnings.join('\n')).toMatch(/unsafe path.*\.\.\/escape\.txt/)
    } finally {
      rmSync(outsideFile, { force: true })
    }
  })

  it('refuses to overwrite a pre-existing hand-written file not created by everyharness', () => {
    const dir = freshFixture()
    writeFileSync(join(dir, 'GEMINI.md'), 'hand-written content, not generated\n')
    expect(() => generate(dir)).toThrowError(/refusing to overwrite existing file\(s\).*GEMINI\.md/)
    expect(readFileSync(join(dir, 'GEMINI.md'), 'utf8')).toBe('hand-written content, not generated\n')
    expect(existsSync(join(dir, MANIFEST_PATH))).toBe(false)
  })

  it('overwrites a pre-existing hand-written file when force is set', () => {
    const dir = freshFixture()
    writeFileSync(join(dir, 'GEMINI.md'), 'hand-written content, not generated\n')
    const result = generate(dir, undefined, { force: true })
    const generatedGemini = result.files.find((f) => f.path === 'GEMINI.md')!
    expect(readFileSync(join(dir, 'GEMINI.md'), 'utf8')).toBe(generatedGemini.content)
    expect(readFileSync(join(dir, 'GEMINI.md'), 'utf8')).not.toBe('hand-written content, not generated\n')
    expect(existsSync(join(dir, MANIFEST_PATH))).toBe(true)
  })

  it('does not refuse a pre-existing file whose content is byte-identical to what would be generated', () => {
    const referenceDir = freshFixture()
    const referenceResult = generate(referenceDir)
    const generatedGeminiContent = referenceResult.files.find((f) => f.path === 'GEMINI.md')!.content

    const dir = freshFixture()
    writeFileSync(join(dir, 'GEMINI.md'), generatedGeminiContent)
    expect(() => generate(dir)).not.toThrow()
    expect(existsSync(join(dir, MANIFEST_PATH))).toBe(true)
  })
})
