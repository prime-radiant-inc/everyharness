import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildModel } from '../../src/model.js'
import { agentsMarketplace } from '../../src/adapters/agents-marketplace.js'
import { adapters, getAdapter } from '../../src/adapters/index.js'

const model = buildModel('fixtures/kitchen-sink')

describe('adapter registry', () => {
  it('registers agents-marketplace', () => {
    expect(adapters.map((a) => a.name)).toContain('agents-marketplace')
    expect(getAdapter('agents-marketplace')).toBe(agentsMarketplace)
  })
})

describe('agents-marketplace adapter', () => {
  const result = agentsMarketplace.emit(model)
  const byPath = Object.fromEntries(result.files.map((f) => [f.path, f.content]))

  it('emits .agents/plugins/marketplace.json with plugin descriptor format', () => {
    const manifest = JSON.parse(byPath['.agents/plugins/marketplace.json'])
    expect(manifest).toEqual({
      name: 'kitchen-sink-dev',
      interface: { displayName: 'kitchen-sink' },
      plugins: [
        {
          name: 'kitchen-sink',
          source: { source: 'url', url: './' },
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
          category: 'Developer Tools',
        },
      ],
    })
  })

  it('warns with empty array (distribution descriptor, not a component emitter)', () => {
    expect(result.warnings).toEqual([])
  })

  it('declares all components as none (descriptor only)', () => {
    expect(agentsMarketplace.support).toEqual({
      skills: 'none',
      commands: 'none',
      agents: 'none',
      hooks: 'none',
      mcp: 'none',
      bootstrap: 'none',
    })
  })
})

describe('agents-marketplace adapter without category', () => {
  it('omits category key when marketplace.category is not set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-agents-marketplace-no-category-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      [
        'name: no-category-demo',
        'version: 1.0.0',
        'description: agents-marketplace fixture without category',
      ].join('\n'),
    )
    const overrideModel = buildModel(dir)
    const result = agentsMarketplace.emit(overrideModel)
    const manifest = JSON.parse(result.files.find((f) => f.path === '.agents/plugins/marketplace.json')!.content)
    expect(manifest.plugins[0]).toEqual({
      name: 'no-category-demo',
      source: { source: 'url', url: './' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    })
    expect(manifest.plugins[0]).not.toHaveProperty('category')
  })
})

describe('agents-marketplace adapter with harnesses.overrides.agents-marketplace', () => {
  it('deep-merges interface.displayName from the override into marketplace.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-agents-marketplace-override-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      [
        'name: override-demo',
        'version: 1.0.0',
        'description: override fixture for agents-marketplace interface.displayName',
        'harnesses:',
        '  overrides:',
        '    agents-marketplace:',
        '      interface:',
        '        displayName: Custom Display',
      ].join('\n'),
    )
    const overrideModel = buildModel(dir)
    const result = agentsMarketplace.emit(overrideModel)
    const manifest = JSON.parse(result.files.find((f) => f.path === '.agents/plugins/marketplace.json')!.content)
    expect(manifest.interface.displayName).toBe('Custom Display')
    expect(manifest.name).toBe('override-demo-dev')
  })
})

describe('agents-marketplace adapter installDoc', () => {
  it('uses repo basename for droid, declared name-dev for copilot, and URL for grok', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-agents-marketplace-installdoc-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      [
        'name: elements-of-style',
        'version: 1.0.0',
        'description: test fixture for install doc',
        'repository: https://github.com/obra/elements-of-style',
      ].join('\n'),
    )
    const testModel = buildModel(dir)
    const doc = agentsMarketplace.installDoc!(testModel)
    // droid uses repo basename, not declared name with -dev
    expect(doc).toContain('droid plugin install elements-of-style@elements-of-style')
    expect(doc).not.toContain('droid plugin install elements-of-style@elements-of-style-dev')
    // copilot uses declared name with -dev suffix
    expect(doc).toContain('copilot plugin install elements-of-style@elements-of-style-dev')
    // grok has its own command structure
    expect(doc).toContain('grok plugin install')
  })

  it('copilot install id uses the configured marketplace.name, not the -dev default', () => {
    // Copilot resolves plugins through Claude Code's .claude-plugin/marketplace.json
    // (verified: GitHub Copilot CLI 1.0.78 registers exactly that descriptor's
    // declared name), so its install id must track marketplace.name — the same
    // name the claude-code adapter writes into that descriptor — not the
    // .agents/plugins/marketplace.json descriptor this adapter emits (always -dev).
    const dir = mkdtempSync(join(tmpdir(), 'eh-agents-marketplace-installdoc-market-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      [
        'name: demo',
        'version: 1.0.0',
        'description: custom marketplace name fixture',
        'repository: https://github.com/obra/demo',
        'marketplace:',
        '  name: demo-market',
      ].join('\n'),
    )
    const testModel = buildModel(dir)
    const doc = agentsMarketplace.installDoc!(testModel)
    expect(doc).toContain('copilot plugin install demo@demo-market')
    expect(doc).not.toContain('copilot plugin install demo@demo-dev')
  })

  it('copilot install id falls back to <name>-dev when marketplace.name is unset', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-agents-marketplace-installdoc-defaultmarket-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      'name: demo\nversion: 1.0.0\ndescription: default marketplace name fixture\n',
    )
    const testModel = buildModel(dir)
    const doc = agentsMarketplace.installDoc!(testModel)
    expect(doc).toContain('copilot plugin install demo@demo-dev')
  })

  it('falls back to <your-repo> when config.repository is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-agents-marketplace-installdoc-norepo-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      'name: no-repo\nversion: 1.0.0\ndescription: no repository fixture\n',
    )
    const noRepoModel = buildModel(dir)
    const doc = agentsMarketplace.installDoc!(noRepoModel)
    expect(doc).toContain('@<your-repo>')
  })

  it('strips .git suffix from repository basename', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-agents-marketplace-installdoc-dotgit-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      [
        'name: elements-of-style',
        'version: 1.0.0',
        'description: test fixture for .git suffix handling',
        'repository: https://github.com/obra/elements-of-style.git',
      ].join('\n'),
    )
    const testModel = buildModel(dir)
    const doc = agentsMarketplace.installDoc!(testModel)
    // droid should use repo basename without .git suffix in the install command
    expect(doc).toContain('droid plugin install elements-of-style@elements-of-style')
    expect(doc).not.toContain('@elements-of-style.git')
  })

  it('strips trailing slash from repository URL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-agents-marketplace-installdoc-trailingslash-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      [
        'name: elements-of-style',
        'version: 1.0.0',
        'description: test fixture for trailing slash handling',
        'repository: https://github.com/obra/elements-of-style/',
      ].join('\n'),
    )
    const testModel = buildModel(dir)
    const doc = agentsMarketplace.installDoc!(testModel)
    // droid should use repo basename, properly handling trailing slash
    expect(doc).toContain('droid plugin install elements-of-style@elements-of-style')
  })
})
