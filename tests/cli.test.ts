import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, cpSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The only test file allowed to shell out: it exercises the built dist/cli.js
// binary directly (spawnSync) to prove the process-level exit-code contract,
// which the in-process unit tests (generate.test.ts, validate.test.ts) can't
// observe since they call the exported functions instead of the CLI.
const REPO_ROOT = process.cwd()
const CLI = join(REPO_ROOT, 'dist', 'cli.js')

function tmpPluginDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eh-cli-'))
  cpSync(join(REPO_ROOT, 'fixtures', 'kitchen-sink'), dir, { recursive: true })
  return dir
}

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' })
}

describe('CLI end-to-end', () => {
  // dist/cli.js is built once via tests/global-setup.ts (vitest globalSetup),
  // before any test file runs.
  it('generate exits 0 and reports 11 harnesses with all adapter names', () => {
    const dir = tmpPluginDir()
    const result = runCli(['generate'], dir)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Generated')
    expect(result.stdout).toContain('11 harness')
    expect(result.stdout).toContain('claude-code')
    expect(result.stdout).toContain('cursor')
    expect(result.stdout).toContain('codex')
    expect(result.stdout).toContain('devin')
    expect(result.stdout).toContain('kimi')
    expect(result.stdout).toContain('gemini')
    expect(result.stdout).toContain('opencode')
    expect(result.stdout).toContain('pi')
    expect(result.stdout).toContain('hermes')
    expect(result.stdout).toContain('agent-plugins-1.0')
    expect(result.stdout).toContain('agents-marketplace')
  })

  it('prints "README.md install section updated" when the fixture README has install markers, and omits it on the idempotent second run', () => {
    const dir = tmpPluginDir()
    const first = runCli(['generate'], dir)
    expect(first.status).toBe(0)
    expect(first.stdout).toContain('README.md install section updated')

    const second = runCli(['generate'], dir)
    expect(second.status).toBe(0)
    expect(second.stdout).not.toContain('README.md install section updated')
  })

  it('validate on a freshly generated plugin exits 0 clean', () => {
    const dir = tmpPluginDir()
    runCli(['generate'], dir)
    const result = runCli(['validate'], dir)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('validate: clean')
  })

  it('validate exits 1 with the same config-error message as generate when everyharness.yaml is v1 syntax (issue #10)', () => {
    const dir = tmpPluginDir()
    runCli(['generate'], dir)
    const yamlPath = join(dir, 'everyharness.yaml')
    const yaml = readFileSync(yamlPath, 'utf8')
    writeFileSync(yamlPath, yaml.replace('bootstrap:\n  skill: using-kitchen-sink', 'bootstrap:\n  generate: true'))

    const validateResult = runCli(['validate'], dir)
    expect(validateResult.status).toBe(1)
    expect(validateResult.stderr).toContain('error:')
    expect(validateResult.stderr).toMatch(/bootstrap is now a tagged value/)

    const generateResult = runCli(['generate'], dir)
    expect(generateResult.status).toBe(1)
    expect(generateResult.stderr).toBe(validateResult.stderr)
  })

  it('prints one "pruned: <path>" line per removed file before the summary count line', () => {
    const dir = tmpPluginDir()
    runCli(['generate'], dir)
    const yamlPath = join(dir, 'everyharness.yaml')
    const yaml = readFileSync(yamlPath, 'utf8')
    writeFileSync(yamlPath, yaml.replace('harnesses:\n', 'harnesses:\n  exclude: [gemini]\n'))

    const result = runCli(['generate'], dir)

    expect(result.status).toBe(0)
    const geminiExtIndex = result.stdout.indexOf('pruned: gemini-extension.json')
    const geminiMdIndex = result.stdout.indexOf('pruned: GEMINI.md')
    const geminiCommandIndex = result.stdout.indexOf('pruned: commands/ks-hello.toml')
    const geminiInstallDocIndex = result.stdout.indexOf('pruned: docs/install/gemini.md')
    const countIndex = result.stdout.indexOf('Pruned 4 stale file(s)')
    expect(geminiExtIndex).toBeGreaterThanOrEqual(0)
    expect(geminiMdIndex).toBeGreaterThanOrEqual(0)
    expect(geminiCommandIndex).toBeGreaterThanOrEqual(0)
    expect(geminiInstallDocIndex).toBeGreaterThanOrEqual(0)
    expect(countIndex).toBeGreaterThan(geminiExtIndex)
    expect(countIndex).toBeGreaterThan(geminiMdIndex)
    expect(countIndex).toBeGreaterThan(geminiCommandIndex)
    expect(countIndex).toBeGreaterThan(geminiInstallDocIndex)
  })

  it('second generate run prunes nothing and validate exits 0', () => {
    const dir = tmpPluginDir()
    runCli(['generate'], dir)
    const secondRun = runCli(['generate'], dir)
    expect(secondRun.status).toBe(0)
    expect(secondRun.stdout).not.toContain('Pruned')
    const validateResult = runCli(['validate'], dir)
    expect(validateResult.status).toBe(0)
  })

  it('validate exits 3 and reports drift after the manifest is tampered with', () => {
    const dir = tmpPluginDir()
    runCli(['generate'], dir)
    writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ tampered: true }))
    const result = runCli(['validate'], dir)
    expect(result.status).toBe(3)
    expect(result.stderr).toContain('drift:')
  })

  it('generate exits 1 with a config error when everyharness.yaml is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-cli-'))
    const result = runCli(['generate'], dir)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('error:')
  })

  it('generate refuses a pre-existing hand-written file, and --force overwrites it', () => {
    const dir = tmpPluginDir()
    writeFileSync(join(dir, 'GEMINI.md'), 'hand-written content, not generated\n')

    const refused = runCli(['generate'], dir)
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('refusing to overwrite')

    const forced = runCli(['generate', '--force'], dir)
    expect(forced.status).toBe(0)
    expect(forced.stdout).toContain('Generated')
  })

  it('bump <version> exits 0 and rewrites the version everywhere', () => {
    const dir = tmpPluginDir()
    runCli(['generate'], dir)
    const result = runCli(['bump', '9.9.9'], dir)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Bumping to 9.9.9')
    expect(result.stdout).toContain('All clear')
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version).toBe('9.9.9')
    expect(JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).version).toBe('9.9.9')
  })

  it('bump --check exits 0 clean and exits 3 on drift', () => {
    const dir = tmpPluginDir()
    runCli(['generate'], dir)

    const clean = runCli(['bump', '--check'], dir)
    expect(clean.status).toBe(0)
    expect(clean.stdout).toContain('in sync')

    writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), '{"tampered": true}\n')
    const drift = runCli(['bump', '--check'], dir)
    expect(drift.status).toBe(3)
    expect(drift.stdout).toContain('DRIFT DETECTED')
  })

  it('bump --audit exits 0 and flags an undeclared version reference', () => {
    const dir = tmpPluginDir()
    runCli(['generate'], dir)
    writeFileSync(join(dir, 'notes.txt'), 'we shipped 0.1.0 today\n')
    const result = runCli(['bump', '--audit'], dir)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('notes.txt')
  })

  it('bump rejects a non-semver version with exit 1', () => {
    const dir = tmpPluginDir()
    runCli(['generate'], dir)
    const result = runCli(['bump', 'not-a-version'], dir)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('semver')
  })

  it('bump with no version and no flag exits 1', () => {
    const dir = tmpPluginDir()
    const result = runCli(['bump'], dir)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('exactly one')
  })

  it('init → generate → validate happy path exits 0 at each step', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-cli-e2e-'))

    const initResult = runCli(['init'], dir)
    expect(initResult.status).toBe(0)
    expect(initResult.stdout).toContain('created: everyharness.yaml')
    expect(initResult.stdout).toContain('created: skills/getting-started/SKILL.md')
    expect(initResult.stdout).toContain('Generated')

    const validateResult = runCli(['validate'], dir)
    expect(validateResult.status).toBe(0)
    expect(validateResult.stdout).toContain('validate: clean')
  })
})
