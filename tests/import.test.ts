import { describe, it, expect, beforeAll } from 'vitest'
import { execSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { importPlugin } from '../src/import.js'
import { ConfigError, loadConfig } from '../src/config.js'

const REPO_ROOT = process.cwd()
const CLI = join(REPO_ROOT, 'dist', 'cli.js')

function tmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' })
}

function writePluginJson(dir: string, data: Record<string, unknown>): void {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify(data, null, 2))
}

function writeSkill(dir: string, skillsDir: string, name: string): void {
  const skillDir = join(dir, skillsDir, name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: test skill\n---\n\nBody.\n`)
}

function writeMd(dir: string, subdir: string, name: string): void {
  mkdirSync(join(dir, subdir), { recursive: true })
  writeFileSync(join(dir, subdir, `${name}.md`), `---\nname: ${name}\n---\n\nBody.\n`)
}

// Full Claude-format plugin fixture used by both the unit-level exact-content
// test and the CLI e2e test: all eight mapped plugin.json fields plus one
// unknown key, both a using-<name> and a non-matching skill, one command,
// one agent, hooks.json, and .mcp.json — all at default locations.
function scaffoldFullFixture(dir: string): void {
  writePluginJson(dir, {
    name: 'demo',
    version: '1.2.3',
    description: 'A demo plugin',
    author: { name: 'Test Author', email: 'test@example.com' },
    homepage: 'https://example.com/demo',
    repository: 'https://github.com/test/demo',
    license: 'MIT',
    keywords: ['demo', 'test'],
    xPortal: { a: 1 },
  })
  writeSkill(dir, 'skills', 'using-demo')
  writeSkill(dir, 'skills', 'other')
  writeMd(dir, 'commands', 'c1')
  writeMd(dir, 'agents', 'a1')
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  writeFileSync(join(dir, 'hooks', 'hooks.json'), JSON.stringify({ hooks: {} }, null, 2))
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: {} }, null, 2))
}

describe('importPlugin', () => {
  it('converts a full Claude-format plugin to an exact everyharness.yaml, with found/warnings', () => {
    const dir = tmpDir('eh-import-full-')
    scaffoldFullFixture(dir)

    const result = importPlugin(dir)

    expect(result.found).toEqual(['skills (2)', 'commands (1)', 'agents (1)', 'hooks', 'mcp'])
    expect(result.warnings).toEqual(['carried unknown plugin.json key "xPortal" into harnesses.overrides.claude-code'])
    expect(result.configPath).toBe(join(dir, 'everyharness.yaml'))

    const expected = stringify({
      name: 'demo',
      version: '1.2.3',
      description: 'A demo plugin',
      author: { name: 'Test Author', email: 'test@example.com' },
      license: 'MIT',
      repository: 'https://github.com/test/demo',
      homepage: 'https://example.com/demo',
      keywords: ['demo', 'test'],
      bootstrap: { skill: 'using-demo' },
      harnesses: { overrides: { 'claude-code': { xPortal: { a: 1 } } } },
    })
    expect(readFileSync(result.configPath, 'utf8')).toBe(expected)

    const config = loadConfig(dir)
    expect(config.name).toBe('demo')
    expect(config.bootstrap).toEqual({ kind: 'skill', skill: 'using-demo' })
  })

  it('uses bootstrap.generate: true when no using-<name> skill is present', () => {
    const dir = tmpDir('eh-import-nobootstrap-')
    writePluginJson(dir, { name: 'no-match', version: '1.0.0', description: 'No matching skill' })
    writeSkill(dir, 'skills', 'other')

    const result = importPlugin(dir)

    expect(result.found).toEqual(['skills (1)'])
    const config = loadConfig(dir)
    expect(config.bootstrap).toEqual({ kind: 'generate' })
  })

  it('refuses when everyharness.yaml already exists', () => {
    const dir = tmpDir('eh-import-existing-')
    writeFileSync(join(dir, 'everyharness.yaml'), 'name: existing\nversion: 1.0.0\ndescription: test\n')

    expect(() => importPlugin(dir)).toThrow(/one-time conversion/)
  })

  it('refuses when .claude-plugin/plugin.json is missing', () => {
    const dir = tmpDir('eh-import-missing-')

    expect(() => importPlugin(dir)).toThrow(/supports Claude-format/)
  })

  it('refuses with a chained cause when plugin.json is corrupt JSON', () => {
    const dir = tmpDir('eh-import-corrupt-')
    mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
    writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), '{ not valid json ')

    try {
      importPlugin(dir)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      expect((err as Error).message).toMatch(/supports Claude-format/)
      expect((err as Error).cause).toBeInstanceOf(Error)
    }
  })

  it('rejects an invalid plugin name, naming the invalid value', () => {
    const dir = tmpDir('eh-import-badname-')
    writePluginJson(dir, { name: 'BadName', version: '1.0.0', description: 'Uppercase name' })

    expect(() => importPlugin(dir)).toThrow(/BadName/)
  })

  it('detects a custom commands path from plugin.json and records it in components', () => {
    const dir = tmpDir('eh-import-custom-')
    writePluginJson(dir, { name: 'custom-paths', version: '1.0.0', description: 'Custom paths', commands: './my-cmds' })
    writeMd(dir, 'my-cmds', 'x')

    const result = importPlugin(dir)

    expect(result.found).toEqual(['commands (1)'])
    const config = loadConfig(dir)
    expect(config.components.commands).toBe('my-cmds')
  })

  it('defaults missing version and description, with warnings', () => {
    const dir = tmpDir('eh-import-defaults-')
    writePluginJson(dir, { name: 'no-defaults' })

    const result = importPlugin(dir)

    expect(result.warnings).toContain('plugin.json has no version; defaulting to 0.1.0')
    expect(result.warnings).toContain('plugin.json has no description; defaulting to "TODO describe this plugin"')
    const config = loadConfig(dir)
    expect(config.version).toBe('0.1.0')
    expect(config.description).toBe('TODO describe this plugin')
  })
})

describe('CLI import command', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: REPO_ROOT, stdio: 'pipe' })
  }, 60000)

  it('exits 0, prints found/Wrote lines, then exits 1 on a second run', () => {
    const dir = tmpDir('eh-cli-import-')
    scaffoldFullFixture(dir)

    const first = runCli(['import'], dir)
    expect(first.status).toBe(0)
    expect(first.stdout).toContain('found: skills (2)')
    expect(first.stdout).toContain('found: commands (1)')
    expect(first.stdout).toContain('found: agents (1)')
    expect(first.stdout).toContain('found: hooks')
    expect(first.stdout).toContain('found: mcp')
    expect(first.stdout).toContain('Wrote everyharness.yaml — review it, then run everyharness generate')
    expect(existsSync(join(dir, 'everyharness.yaml'))).toBe(true)

    const second = runCli(['import'], dir)
    expect(second.status).toBe(1)
    expect(second.stderr).toContain('one-time conversion')
  })

  it('respects --dir option', () => {
    const base = tmpDir('eh-cli-import-dir-')
    const testDir = join(base, 'plugin')
    mkdirSync(testDir, { recursive: true })
    scaffoldFullFixture(testDir)

    const result = runCli(['import', '--dir', testDir], base)

    expect(result.status).toBe(0)
    expect(existsSync(join(testDir, 'everyharness.yaml'))).toBe(true)
  })
})
