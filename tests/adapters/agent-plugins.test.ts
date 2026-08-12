import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildModel } from '../../src/model.js'
import { agentPlugins } from '../../src/adapters/agent-plugins.js'
import { adapters, getAdapter } from '../../src/adapters/index.js'

const model = buildModel('fixtures/kitchen-sink')

function mcpFixtureModel(mcpServers: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'eh-ap-mcp-'))
  writeFileSync(
    join(dir, 'everyharness.yaml'),
    'name: mcp-fixture\nversion: 1.0.0\ndescription: mcp translation fixture\nbootstrap: none\n',
  )
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers }))
  return buildModel(dir)
}

describe('adapter registry', () => {
  it('registers agent-plugins-1.0', () => {
    expect(adapters.map((a) => a.name)).toContain('agent-plugins-1.0')
    expect(getAdapter('agent-plugins-1.0')).toBe(agentPlugins)
  })
})

describe('agent-plugins-1.0 adapter', () => {
  const result = agentPlugins.emit(model)
  const byPath = Object.fromEntries(result.files.map((f) => [f.path, f.content]))

  it('emits root plugin.json with the closed-schema field set', () => {
    const manifest = JSON.parse(byPath['plugin.json'])
    expect(manifest).toEqual({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'kitchen-sink',
      version: '0.1.0',
      description: 'Fixture plugin exercising every component type',
      author: { name: 'Prime Radiant', email: 'dev@prime-radiant.example' },
      license: 'MIT',
      repository: 'https://github.com/prime-radiant-inc/everyharness',
      keywords: ['fixture'],
    })
  })

  it('emits root mcp.json translating the kitchen-sink stdio server', () => {
    const mcp = JSON.parse(byPath['mcp.json'])
    expect(mcp).toEqual({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {
        'ks-demo': { type: 'stdio', command: 'node', args: ['./mcp-demo-server.js'] },
      },
    })
  })

  it('warns that commands, agents, and hooks are excluded from the spec', () => {
    expect(result.warnings).toEqual([
      'commands are excluded from the Agent Plugins 1.0 spec',
      'agents are excluded from the Agent Plugins 1.0 spec',
      'hooks are excluded from the Agent Plugins 1.0 spec',
    ])
  })

  it('declares expected support levels', () => {
    expect(agentPlugins.support).toEqual({
      skills: 'full',
      commands: 'none',
      agents: 'none',
      hooks: 'none',
      mcp: 'full',
      bootstrap: 'none',
    })
  })
})

describe('agent-plugins-1.0 mcp server translation', () => {
  it('translates a url server without a type to streamable-http', () => {
    const result = agentPlugins.emit(mcpFixtureModel({ demo: { url: 'https://example.com/mcp' } }))
    const mcp = JSON.parse(result.files.find((f) => f.path === 'mcp.json')!.content)
    expect(mcp.mcpServers.demo).toEqual({ type: 'streamable-http', url: 'https://example.com/mcp' })
    expect(result.warnings).toEqual([])
  })

  it('passes through an sse server', () => {
    const result = agentPlugins.emit(mcpFixtureModel({ demo: { url: 'https://example.com/sse', type: 'sse' } }))
    const mcp = JSON.parse(result.files.find((f) => f.path === 'mcp.json')!.content)
    expect(mcp.mcpServers.demo).toEqual({ type: 'sse', url: 'https://example.com/sse' })
    expect(result.warnings).toEqual([])
  })

  it('skips a shell-string command with a warning', () => {
    const result = agentPlugins.emit(mcpFixtureModel({ demo: { command: 'node x.js' } }))
    const mcp = JSON.parse(result.files.find((f) => f.path === 'mcp.json')!.content)
    expect(mcp.mcpServers.demo).toBeUndefined()
    expect(result.warnings).toEqual(['mcp server "demo" command is not a single executable token; skipped'])
  })

  it('drops a reserved PLUGIN_ROOT env key with a warning but keeps the server', () => {
    const result = agentPlugins.emit(
      mcpFixtureModel({ demo: { command: 'node', env: { PLUGIN_ROOT: '/x', OTHER: 'y' } } }),
    )
    const mcp = JSON.parse(result.files.find((f) => f.path === 'mcp.json')!.content)
    expect(mcp.mcpServers.demo).toEqual({ type: 'stdio', command: 'node', env: { OTHER: 'y' } })
    expect(result.warnings).toEqual(['mcp server "demo" env key "PLUGIN_ROOT" is reserved by Agent Plugins; dropped'])
  })

  it('warns and skips a server with neither command nor url', () => {
    const result = agentPlugins.emit(mcpFixtureModel({ demo: {} }))
    const mcp = JSON.parse(result.files.find((f) => f.path === 'mcp.json')!.content)
    expect(mcp.mcpServers.demo).toBeUndefined()
    expect(result.warnings).toEqual(['mcp server "demo" could not be translated to Agent Plugins format; skipped'])
  })
})

describe('agent-plugins-1.0 name gate', () => {
  it('skips emission entirely for a name invalid under the Agent Plugins pattern, with one warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-ap-name-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      'name: bad--name\nversion: 1.0.0\ndescription: name gate fixture\nbootstrap: none\n',
    )
    const badModel = buildModel(dir)
    const result = agentPlugins.emit(badModel)
    expect(result.files).toEqual([])
    expect(result.warnings).toEqual([
      'plugin name "bad--name" is not valid under the Agent Plugins 1.0 spec; skipping agent-plugins-1.0 output',
    ])
  })
})

describe('agent-plugins-1.0 without an mcp source', () => {
  it('emits no mcp.json when model.mcp is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-ap-no-mcp-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      'name: no-mcp\nversion: 1.0.0\ndescription: no mcp fixture\nbootstrap: none\n',
    )
    const noMcpModel = buildModel(dir)
    const result = agentPlugins.emit(noMcpModel)
    expect(result.files.some((f) => f.path === 'mcp.json')).toBe(false)
  })
})

describe('agent-plugins-1.0 with malformed mcpServers', () => {
  it('warns and emits no mcp.json when the mcp source has no mcpServers object', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-ap-badmcp-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      'name: bad-mcp-shape\nversion: 1.0.0\ndescription: malformed mcpServers fixture\nbootstrap: none\n',
    )
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ servers: {} }))
    const badMcpModel = buildModel(dir)
    const result = agentPlugins.emit(badMcpModel)
    expect(result.files.some((f) => f.path === 'mcp.json')).toBe(false)
    expect(result.warnings).toContain('mcp config has no mcpServers object; nothing translated for agent-plugins-1.0')
  })
})

describe('agent-plugins-1.0 with a non-default skills path', () => {
  it('warns that the custom skills directory will not be discovered', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-ap-skills-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      'name: custom-skills\nversion: 1.0.0\ndescription: custom skills path fixture\ncomponents:\n  skills: my-skills\nbootstrap: none\n',
    )
    const customModel = buildModel(dir)
    const result = agentPlugins.emit(customModel)
    expect(result.warnings).toContain(
      'agent-plugins-1.0 requires skills/ at the plugin root; my-skills will not be discovered',
    )
  })
})

describe('agent-plugins-1.0 mcp.json collision with the source MCP config', () => {
  it('skips mcp.json emission and warns, but still emits plugin.json, when components.mcp is mcp.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-ap-mcp-collision-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      'name: mcp-collision\nversion: 1.0.0\ndescription: mcp.json collision fixture\ncomponents:\n  mcp: mcp.json\nbootstrap: none\n',
    )
    writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ mcpServers: { demo: { command: 'node' } } }))
    const collisionModel = buildModel(dir)
    const result = agentPlugins.emit(collisionModel)
    expect(result.files.some((f) => f.path === 'mcp.json')).toBe(false)
    expect(result.files.some((f) => f.path === 'plugin.json')).toBe(true)
    expect(result.warnings).toEqual([
      'mcp.json is occupied by the source MCP config (components.mcp); agent-plugins-1.0 mcp output skipped — rename the source to .mcp.json',
    ])
  })
})

describe('agent-plugins-1.0 with harnesses[agent-plugins-1.0].manifest.extensions', () => {
  it('copies only object-valued extension entries and warns about the rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-ap-ext-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      [
        'name: ext-demo',
        'version: 1.0.0',
        'description: extensions override fixture',
        'bootstrap: none',
        'harnesses:',
        '  agent-plugins-1.0:',
        '    manifest:',
        '      extensions:',
        '        com.example.demo:',
        '          enabled: true',
        '        com.example.bad: not-an-object',
      ].join('\n'),
    )
    const extModel = buildModel(dir)
    const result = agentPlugins.emit(extModel)
    const manifest = JSON.parse(result.files.find((f) => f.path === 'plugin.json')!.content)
    expect(manifest.extensions).toEqual({ 'com.example.demo': { enabled: true } })
    expect(result.warnings).toContain('extensions entry "com.example.bad" is not an object; dropped')
  })
})
