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
      mcpServers: './mcp.json'
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
