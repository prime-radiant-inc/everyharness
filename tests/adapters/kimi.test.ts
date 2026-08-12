import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildModel } from '../../src/model.js'
import { kimi } from '../../src/adapters/kimi.js'
import { adapters, getAdapter } from '../../src/adapters/index.js'

const model = buildModel('fixtures/kitchen-sink')

describe('adapter registry', () => {
  it('registers kimi', () => {
    expect(adapters.map((a) => a.name)).toContain('kimi')
    expect(getAdapter('kimi')).toBe(kimi)
  })
})

describe('kimi adapter', () => {
  const result = kimi.emit(model)
  const byPath = Object.fromEntries(result.files.map((f) => [f.path, f.content]))

  it('emits .kimi-plugin/plugin.json with base fields, skills path, and sessionStart', () => {
    const manifest = JSON.parse(byPath['.kimi-plugin/plugin.json'])
    expect(manifest).toEqual({
      name: 'kitchen-sink',
      version: '0.1.0',
      description: 'Fixture plugin exercising every component type',
      author: { name: 'Prime Radiant', email: 'dev@prime-radiant.example' },
      license: 'MIT',
      repository: 'https://github.com/prime-radiant-inc/everyharness',
      keywords: ['fixture'],
      skills: './skills/',
      sessionStart: { skill: 'using-kitchen-sink' },
    })
  })

  it('warns about hooks, commands, agents, and mcp not being emitted for kimi', () => {
    expect(result.warnings).toEqual([
      'hooks are not emitted for kimi',
      'commands are not emitted for kimi',
      'agents are not emitted for kimi',
      'mcp servers are not emitted for kimi',
    ])
  })

  it('declares expected support levels', () => {
    // bootstrap is 'partial', not 'full': kimi's sessionStart only supports a
    // named bootstrap skill -- bootstrap.generate mode is not supported (see
    // the bootstrap.generate warning test below).
    expect(kimi.support).toEqual({
      skills: 'full',
      commands: 'none',
      agents: 'none',
      hooks: 'none',
      mcp: 'none',
      bootstrap: 'partial',
    })
  })
})

describe('kimi adapter with harnesses.kimi.manifest', () => {
  it('deep-merges plugin-specific skillInstructions from the manifest patch into plugin.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-kimi-override-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      [
        'name: override-demo',
        'version: 1.0.0',
        'description: override fixture for kimi skillInstructions metadata',
        'harnesses:',
        '  kimi:',
        '    manifest:',
        '      skillInstructions: map things',
      ].join('\n'),
    )
    const overrideModel = buildModel(dir)
    const result = kimi.emit(overrideModel)
    const manifest = JSON.parse(result.files.find((f) => f.path === '.kimi-plugin/plugin.json')!.content)
    expect(manifest.skillInstructions).toBe('map things')
  })
})

describe('kimi adapter with bootstrap.none', () => {
  it('emits no sessionStart key and no bootstrap warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-kimi-none-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      'name: no-bootstrap\nversion: 1.0.0\ndescription: bootstrap none fixture\nbootstrap: none\n',
    )
    const noneModel = buildModel(dir)
    const result = kimi.emit(noneModel)
    const manifest = JSON.parse(result.files.find((f) => f.path === '.kimi-plugin/plugin.json')!.content)
    expect('sessionStart' in manifest).toBe(false)
    expect(result.warnings).toEqual([])
  })
})

describe('kimi adapter with bootstrap.generate', () => {
  it('warns that generate mode is not supported on kimi and emits no sessionStart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-kimi-generate-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      'name: generate-bootstrap\nversion: 1.0.0\ndescription: bootstrap.generate fixture\nbootstrap: generate\n',
    )
    const generateModel = buildModel(dir)
    const result = kimi.emit(generateModel)
    expect(result.warnings).toEqual([
      'kimi sessionStart requires a named bootstrap skill; generate mode is not supported on kimi',
    ])
    const manifest = JSON.parse(result.files.find((f) => f.path === '.kimi-plugin/plugin.json')!.content)
    expect(manifest.sessionStart).toBeUndefined()
  })
})
