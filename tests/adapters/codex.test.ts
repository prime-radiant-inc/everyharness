import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildModel } from '../../src/model.js'
import { codex } from '../../src/adapters/codex.js'
import { adapters, getAdapter } from '../../src/adapters/index.js'

const model = buildModel('fixtures/kitchen-sink')

describe('adapter registry', () => {
  it('registers codex', () => {
    expect(adapters.map((a) => a.name)).toContain('codex')
    expect(getAdapter('codex')).toBe(codex)
  })
})

describe('codex adapter', () => {
  const result = codex.emit(model)
  const byPath = Object.fromEntries(result.files.map((f) => [f.path, f.content]))

  it('emits .codex-plugin/plugin.json with base fields, always-empty hooks, and no interface (no codex override in kitchen-sink)', () => {
    const manifest = JSON.parse(byPath['.codex-plugin/plugin.json'])
    expect(manifest).toEqual({
      name: 'kitchen-sink',
      version: '0.1.0',
      description: 'Fixture plugin exercising every component type',
      author: { name: 'Prime Radiant', email: 'dev@prime-radiant.example' },
      license: 'MIT',
      repository: 'https://github.com/prime-radiant-inc/everyharness',
      keywords: ['fixture'],
      skills: './skills/',
      hooks: {},
    })
  })

  it('warns about hooks, commands, agents, and mcp not being emitted for codex', () => {
    expect(result.warnings).toEqual([
      'hooks are not supported on codex; bootstrap relies on native skill discovery',
      'commands are not emitted for codex in v1 (custom prompts land in Plan 3)',
      'agents are not emitted for codex in v1',
      'mcp servers are not emitted for codex in v1',
    ])
  })

  it('declares expected support levels', () => {
    expect(codex.support).toEqual({
      skills: 'full',
      commands: 'none',
      agents: 'none',
      hooks: 'none',
      mcp: 'none',
      bootstrap: 'partial',
    })
  })
})

describe('codex adapter with harnesses.overrides.codex', () => {
  it('deep-merges interface portal metadata from the override into plugin.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-codex-override-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      [
        'name: override-demo',
        'version: 1.0.0',
        'description: override fixture for codex interface metadata',
        'harnesses:',
        '  overrides:',
        '    codex:',
        '      interface:',
        '        displayName: Demo',
      ].join('\n'),
    )
    const overrideModel = buildModel(dir)
    const result = codex.emit(overrideModel)
    const manifest = JSON.parse(result.files.find((f) => f.path === '.codex-plugin/plugin.json')!.content)
    expect(manifest.interface.displayName).toBe('Demo')
  })
})
