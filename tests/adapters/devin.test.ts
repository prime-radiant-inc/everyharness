import { describe, it, expect } from 'vitest'
import { buildModel } from '../../src/model.js'
import { devin } from '../../src/adapters/devin.js'
import { adapters, getAdapter } from '../../src/adapters/index.js'

const model = buildModel('fixtures/kitchen-sink')

describe('adapter registry', () => {
  it('registers devin', () => {
    expect(adapters.map((a) => a.name)).toContain('devin')
    expect(getAdapter('devin')).toBe(devin)
  })
})

describe('devin adapter', () => {
  const result = devin.emit(model)
  const byPath = Object.fromEntries(result.files.map((f) => [f.path, f.content]))

  it('emits .devin-plugin/plugin.json with base fields only (no skills/hooks keys)', () => {
    const manifest = JSON.parse(byPath['.devin-plugin/plugin.json'])
    expect(manifest).toEqual({
      name: 'kitchen-sink',
      version: '0.1.0',
      description: 'Fixture plugin exercising every component type',
      author: { name: 'Prime Radiant', email: 'dev@prime-radiant.example' },
      license: 'MIT',
      repository: 'https://github.com/prime-radiant-inc/everyharness',
      keywords: ['fixture'],
    })
  })

  it('warns about hooks, commands, agents, and mcp not being emitted for devin', () => {
    expect(result.warnings).toEqual([
      'hooks are not emitted for devin',
      'commands are not emitted for devin',
      'agents are not emitted for devin',
      'mcp servers are not emitted for devin',
    ])
  })

  it('declares expected support levels', () => {
    expect(devin.support).toEqual({
      skills: 'full',
      commands: 'none',
      agents: 'none',
      hooks: 'none',
      mcp: 'none',
      bootstrap: 'none',
    })
  })
})
