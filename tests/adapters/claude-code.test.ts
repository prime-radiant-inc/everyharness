import { describe, it, expect } from 'vitest'
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
