import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

describe('cursor adapter with harnesses.overrides.cursor', () => {
  it('overrides displayName via harnesses.overrides.cursor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-cursor-override-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      [
        'name: override-demo',
        'version: 1.0.0',
        'description: override fixture for cursor displayName',
        'bootstrap:',
        '  none: true',
        'harnesses:',
        '  overrides:',
        '    cursor:',
        '      displayName: Fancy',
      ].join('\n'),
    )
    const overrideModel = buildModel(dir)
    const result = cursor.emit(overrideModel)
    const manifest = JSON.parse(result.files.find((f) => f.path === '.cursor-plugin/plugin.json')!.content)
    expect(manifest.displayName).toBe('Fancy')
  })
})

describe('cursor adapter with bootstrap.emitHooks: false', () => {
  it('emits no hooks/ files and no manifest hooks key for skill mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-cursor-emithooks-skill-'))
    mkdirSync(join(dir, 'skills', 'using-demo'), { recursive: true })
    writeFileSync(
      join(dir, 'skills', 'using-demo', 'SKILL.md'),
      '---\nname: using-demo\ndescription: demo bootstrap skill\n---\n\nBody.\n',
    )
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      'name: no-hooks\nversion: 1.0.0\ndescription: emitHooks false fixture\nbootstrap:\n  skill: using-demo\n  emitHooks: false\n',
    )
    const noHooksModel = buildModel(dir)
    const result = cursor.emit(noHooksModel)
    expect(result.files.map((f) => f.path).filter((p) => p.startsWith('hooks/'))).toEqual([])
    const manifest = JSON.parse(result.files.find((f) => f.path === '.cursor-plugin/plugin.json')!.content)
    expect(manifest).not.toHaveProperty('hooks')
  })

  it('still writes the generated bootstrap.md for generate mode, but no shell-hook files or manifest hooks key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-cursor-emithooks-generate-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      'name: no-hooks-generate\nversion: 1.0.0\ndescription: emitHooks false generate fixture\nbootstrap:\n  generate: true\n  emitHooks: false\n',
    )
    const noHooksModel = buildModel(dir)
    const result = cursor.emit(noHooksModel)
    const bootstrapMd = result.files.find((f) => f.path === 'hooks/everyharness/bootstrap.md')
    expect(bootstrapMd).toBeDefined()
    expect(bootstrapMd?.content).toContain('# no-hooks-generate plugin')
    const hookFiles = result.files.map((f) => f.path).filter((p) => p.startsWith('hooks/') && p !== 'hooks/everyharness/bootstrap.md')
    expect(hookFiles).toEqual([])
    const manifest = JSON.parse(result.files.find((f) => f.path === '.cursor-plugin/plugin.json')!.content)
    expect(manifest).not.toHaveProperty('hooks')
  })

  it('drops the bootstrap-hook bullet from installDoc', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-cursor-emithooks-installdoc-'))
    mkdirSync(join(dir, 'skills', 'using-demo'), { recursive: true })
    writeFileSync(
      join(dir, 'skills', 'using-demo', 'SKILL.md'),
      '---\nname: using-demo\ndescription: demo bootstrap skill\n---\n\nBody.\n',
    )
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      'name: no-hooks-doc\nversion: 1.0.0\ndescription: emitHooks false installDoc fixture\nbootstrap:\n  skill: using-demo\n  emitHooks: false\n',
    )
    const noHooksModel = buildModel(dir)
    const body = cursor.installDoc!(noHooksModel)
    expect(body).not.toContain('bootstrap hook')
  })

  it('does not claim a bootstrap hook is emitted in the Caveats section when the plugin has hand-written hooks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-cursor-emithooks-installdoc-hooks-'))
    mkdirSync(join(dir, 'skills', 'using-demo'), { recursive: true })
    writeFileSync(
      join(dir, 'skills', 'using-demo', 'SKILL.md'),
      '---\nname: using-demo\ndescription: demo bootstrap skill\n---\n\nBody.\n',
    )
    mkdirSync(join(dir, 'hooks'), { recursive: true })
    writeFileSync(join(dir, 'hooks', 'hooks.json'), '{"hooks":{}}\n')
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      'name: no-hooks-doc-hooks\nversion: 1.0.0\ndescription: emitHooks false installDoc fixture with hand-written hooks\nbootstrap:\n  skill: using-demo\n  emitHooks: false\n',
    )
    const noHooksModel = buildModel(dir)
    const body = cursor.installDoc!(noHooksModel)
    expect(body).toContain('## Caveats')
    expect(body).not.toContain('only the bootstrap sessionStart hook is emitted')
    expect(body).toContain('no hooks are emitted for Cursor')
  })
})

describe('cursor adapter with bootstrap.generate', () => {
  it('emits a generated bootstrap.md wired into the session-start hook', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-cursor-generate-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      'name: generate-bootstrap\nversion: 1.0.0\ndescription: bootstrap.generate fixture\nbootstrap:\n  generate: true\n',
    )
    const generateModel = buildModel(dir)
    const result = cursor.emit(generateModel)
    expect(result.warnings).toEqual([])
    const bootstrapMd = result.files.find((f) => f.path === 'hooks/everyharness/bootstrap.md')
    expect(bootstrapMd?.content).toContain('# generate-bootstrap plugin')
    const sessionStart = result.files.find((f) => f.path === 'hooks/everyharness/session-start')
    expect(sessionStart?.executable).toBe(true)
    expect(sessionStart?.content).toContain('hooks/everyharness/bootstrap.md')
    const manifest = JSON.parse(result.files.find((f) => f.path === '.cursor-plugin/plugin.json')!.content)
    expect(manifest.hooks).toBe('./hooks/everyharness/hooks-cursor.json')
  })
})
