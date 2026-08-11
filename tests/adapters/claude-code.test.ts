import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildModel } from '../../src/model.js'
import { claudeCode } from '../../src/adapters/claude-code.js'
import { adapters, getAdapter } from '../../src/adapters/index.js'

const model = buildModel('fixtures/kitchen-sink')

describe('adapter registry', () => {
  it('registers claude-code', () => {
    expect(adapters.map((a) => a.name)).toContain('claude-code')
    expect(getAdapter('claude-code')).toBe(claudeCode)
    expect(getAdapter('nope')).toBeUndefined()
  })
})

describe('claude-code adapter', () => {
  const result = claudeCode.emit(model)
  const byPath = Object.fromEntries(result.files.map((f) => [f.path, f.content]))

  it('emits plugin.json with config fields, override merge, and mcp path', () => {
    const manifest = JSON.parse(byPath['.claude-plugin/plugin.json'])
    expect(manifest).toEqual({
      name: 'kitchen-sink',
      version: '0.1.0',
      description: 'Fixture plugin exercising every component type',
      author: { name: 'Prime Radiant', email: 'dev@prime-radiant.example' },
      license: 'MIT',
      repository: 'https://github.com/prime-radiant-inc/everyharness',
      keywords: ['fixture'],
      homepage: 'https://example.com/kitchen-sink',
      hooks: './hooks/everyharness/hooks.json',
    })
  })

  it('emits a dev marketplace listing the plugin at source ./', () => {
    const marketplace = JSON.parse(byPath['.claude-plugin/marketplace.json'])
    expect(marketplace.name).toBe('kitchen-sink-dev')
    expect(marketplace.owner).toEqual({ name: 'Prime Radiant', email: 'dev@prime-radiant.example' })
    expect(marketplace.plugins).toEqual([
      {
        name: 'kitchen-sink',
        description: 'Fixture plugin exercising every component type',
        version: '0.1.0',
        source: './',
        author: { name: 'Prime Radiant', email: 'dev@prime-radiant.example' },
        category: 'Developer Tools',
        keywords: ['demo', 'fixture']
      }
    ])
  })

  it('emits no warnings for full-support components', () => {
    expect(result.warnings).toEqual([])
  })

  it('declares full support for every component', () => {
    expect(Object.values(claudeCode.support).every((level) => level === 'full')).toBe(true)
  })

  it('emits an executable bootstrap session-start hook', () => {
    const file = result.files.find((f) => f.path === 'hooks/everyharness/session-start')
    expect(file?.executable).toBe(true)
    expect(file?.content).toContain('skills/using-kitchen-sink/SKILL.md')
  })

  it('emits an executable run-hook.cmd polyglot', () => {
    const file = result.files.find((f) => f.path === 'hooks/everyharness/run-hook.cmd')
    expect(file?.executable).toBe(true)
    expect(file?.content.startsWith(": << 'CMDBLOCK'")).toBe(true)
  })

  it('emits hooks.json merging the fixture hook with the bootstrap SessionStart entry', () => {
    const hooks = JSON.parse(byPath['hooks/everyharness/hooks.json'])
    expect(hooks.hooks.SessionStart).toHaveLength(2)
    expect(JSON.stringify(hooks.hooks.SessionStart[1])).toContain('hooks/everyharness/run-hook.cmd')
  })
})

describe('claude-code adapter with bootstrap.generate', () => {
  it('warns that generate falls back to none and emits no bootstrap files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-claude-code-generate-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      'name: generate-bootstrap\nversion: 1.0.0\ndescription: bootstrap.generate fixture\nbootstrap:\n  generate: true\n',
    )
    const generateModel = buildModel(dir)
    const result = claudeCode.emit(generateModel)
    expect(result.warnings).toEqual(['bootstrap.generate is not implemented until Plan 3; falling back to none'])
    expect(result.files.some((f) => f.path.startsWith('hooks/everyharness/'))).toBe(false)
    const manifest = JSON.parse(result.files.find((f) => f.path === '.claude-plugin/plugin.json')!.content)
    expect(manifest.hooks).toBeUndefined()
  })
})

describe('claude-code adapter with a non-default skills path', () => {
  it('emits a skills key in plugin.json pointing at the custom directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-claude-code-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      'name: custom-skills\nversion: 1.0.0\ndescription: custom skills path fixture\ncomponents:\n  skills: my-skills\n',
    )
    mkdirSync(join(dir, 'my-skills', 'demo'), { recursive: true })
    writeFileSync(
      join(dir, 'my-skills', 'demo', 'SKILL.md'),
      '---\nname: demo\ndescription: demo skill for custom path test\n---\n\nBody.\n',
    )
    const customModel = buildModel(dir)
    const result = claudeCode.emit(customModel)
    const manifest = JSON.parse(result.files.find((f) => f.path === '.claude-plugin/plugin.json')!.content)
    expect(manifest.skills).toBe('./my-skills')
  })
})
