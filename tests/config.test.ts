import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, ConfigError } from '../src/config.js'

function repoWith(yamlText: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'eh-config-'))
  writeFileSync(join(dir, 'everyharness.yaml'), yamlText)
  return dir
}

describe('loadConfig', () => {
  it('loads a minimal config with defaults', () => {
    const cfg = loadConfig(repoWith(
      'name: demo\nversion: 1.0.0\ndescription: A demo plugin\n'
    ))
    expect(cfg.name).toBe('demo')
    expect(cfg.version).toBe('1.0.0')
    expect(cfg.bootstrap).toEqual({ kind: 'none' })
    expect(cfg.components).toEqual({
      skills: 'skills',
      commands: 'commands',
      agents: 'agents',
      hooks: 'hooks/hooks.json',
      mcp: 'mcp.json',
    })
    expect(cfg.harnesses).toEqual({ exclude: [], overrides: {} })
  })

  it('loads a full config', () => {
    const cfg = loadConfig(repoWith([
      'name: kitchen-sink',
      'version: 0.1.0',
      'description: Fixture',
      'author: { name: Prime Radiant, email: dev@prime-radiant.example }',
      'license: MIT',
      'repository: https://github.com/prime-radiant-inc/everyharness',
      'keywords: [fixture]',
      'bootstrap:',
      '  skill: using-kitchen-sink',
      'harnesses:',
      '  exclude: [devin]',
      '  overrides:',
      '    claude-code:',
      '      homepage: https://example.com/kitchen-sink',
      'marketplace:',
      '  category: Developer Tools',
      '  tags: [demo]',
    ].join('\n')))
    expect(cfg.bootstrap).toEqual({ kind: 'skill', skill: 'using-kitchen-sink' })
    expect(cfg.harnesses.exclude).toEqual(['devin'])
    expect(cfg.harnesses.overrides['claude-code']).toEqual({
      homepage: 'https://example.com/kitchen-sink',
    })
    expect(cfg.author?.name).toBe('Prime Radiant')
  })

  it('rejects a missing required field, naming its YAML path', () => {
    expect(() => loadConfig(repoWith('version: 1.0.0\ndescription: x\n')))
      .toThrowError(ConfigError)
    try {
      loadConfig(repoWith('version: 1.0.0\ndescription: x\n'))
    } catch (e) {
      expect((e as ConfigError).details.join('\n')).toContain('name')
    }
  })

  it('rejects a bootstrap block with two modes', () => {
    expect(() => loadConfig(repoWith(
      'name: x\nversion: 1.0.0\ndescription: x\nbootstrap:\n  skill: a\n  generate: true\n'
    ))).toThrowError(/exactly one/i)
  })

  it('reports a missing everyharness.yaml as a ConfigError', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-empty-'))
    expect(() => loadConfig(dir)).toThrowError(/everyharness\.yaml not found/)
  })

  it('rejects version 1.0.0 x (trailing garbage)', () => {
    expect(() => loadConfig(repoWith(
      'name: bad\nversion: 1.0.0 x\ndescription: bad\n'
    ))).toThrowError(ConfigError)
    try {
      loadConfig(repoWith('name: bad\nversion: 1.0.0 x\ndescription: bad\n'))
    } catch (e) {
      expect((e as ConfigError).details.join('\n')).toContain('version')
    }
  })

  it('rejects version 1.0.0.7 (too many segments)', () => {
    expect(() => loadConfig(repoWith(
      'name: bad\nversion: 1.0.0.7\ndescription: bad\n'
    ))).toThrowError(ConfigError)
    try {
      loadConfig(repoWith('name: bad\nversion: 1.0.0.7\ndescription: bad\n'))
    } catch (e) {
      expect((e as ConfigError).details.join('\n')).toContain('version')
    }
  })

  it('accepts version 1.2.3-rc.1 (prerelease suffix)', () => {
    const cfg = loadConfig(repoWith(
      'name: demo\nversion: 1.2.3-rc.1\ndescription: test\n'
    ))
    expect(cfg.version).toBe('1.2.3-rc.1')
  })

  it('rejects invalid YAML syntax', () => {
    expect(() => loadConfig(repoWith(
      'name: [unclosed\n'
    ))).toThrowError(ConfigError)
    try {
      loadConfig(repoWith('name: [unclosed\n'))
    } catch (e) {
      expect((e as ConfigError).message).toMatch(/not valid YAML/)
    }
  })

  it('rejects an empty bootstrap block', () => {
    expect(() => loadConfig(repoWith(
      'name: x\nversion: 1.0.0\ndescription: x\nbootstrap: {}\n'
    ))).toThrowError(/exactly one/i)
  })
})
