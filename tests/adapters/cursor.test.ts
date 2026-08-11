import { describe, it, expect } from 'vitest'
import { buildModel } from '../../src/model.js'
import { cursor } from '../../src/adapters/cursor.js'
import { claudeCode } from '../../src/adapters/claude-code.js'
import { adapters, getAdapter } from '../../src/adapters/index.js'

const model = buildModel('fixtures/kitchen-sink')

describe('adapter registry', () => {
  it('registers cursor', () => {
    expect(adapters.map((a) => a.name)).toContain('cursor')
    expect(getAdapter('cursor')).toBe(cursor)
  })
})

describe('cursor adapter', () => {
  const result = cursor.emit(model)
  const byPath = Object.fromEntries(result.files.map((f) => [f.path, f.content]))

  it('emits .cursor-plugin/plugin.json with config fields (no homepage leak from claude-code override)', () => {
    const manifest = JSON.parse(byPath['.cursor-plugin/plugin.json'])
    expect(manifest).toEqual({
      name: 'kitchen-sink',
      displayName: 'kitchen-sink',
      description: 'Fixture plugin exercising every component type',
      version: '0.1.0',
      author: { name: 'Prime Radiant', email: 'dev@prime-radiant.example' },
      license: 'MIT',
      repository: 'https://github.com/prime-radiant-inc/everyharness',
      keywords: ['fixture'],
      skills: './skills/',
      hooks: './hooks/everyharness/hooks-cursor.json',
    })
  })

  it('emits hooks-cursor.json with the sessionStart command', () => {
    const hooks = JSON.parse(byPath['hooks/everyharness/hooks-cursor.json'])
    expect(hooks).toEqual({
      version: 1,
      hooks: {
        sessionStart: [{ command: './hooks/everyharness/run-hook.cmd session-start' }],
      },
    })
  })

  it('emits session-start and run-hook.cmd identical to claude-code, executable', () => {
    const claudeResult = claudeCode.emit(model)
    const claudeByPath = Object.fromEntries(claudeResult.files.map((f) => [f.path, f]))
    const cursorByPath = Object.fromEntries(result.files.map((f) => [f.path, f]))

    const sessionStart = cursorByPath['hooks/everyharness/session-start']
    expect(sessionStart?.executable).toBe(true)
    expect(sessionStart?.content).toBe(claudeByPath['hooks/everyharness/session-start']?.content)

    const runHookCmd = cursorByPath['hooks/everyharness/run-hook.cmd']
    expect(runHookCmd?.executable).toBe(true)
    expect(runHookCmd?.content).toBe(claudeByPath['hooks/everyharness/run-hook.cmd']?.content)
  })

  it('warns about user hooks, commands, agents, and mcp not being translated/emitted', () => {
    expect(result.warnings).toEqual([
      'user hooks are not translated for cursor in v1',
      'commands are not emitted for cursor in v1',
      'agents are not emitted for cursor in v1',
      'mcp servers are not emitted for cursor in v1',
    ])
  })

  it('declares expected support levels', () => {
    expect(cursor.support).toEqual({
      skills: 'full',
      commands: 'none',
      agents: 'none',
      hooks: 'partial',
      mcp: 'none',
      bootstrap: 'full',
    })
  })
})
