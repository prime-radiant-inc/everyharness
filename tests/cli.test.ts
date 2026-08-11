import { describe, it, expect, beforeAll } from 'vitest'
import { execSync, spawnSync } from 'node:child_process'
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
  beforeAll(() => {
    execSync('npm run build', { cwd: REPO_ROOT, stdio: 'pipe' })
  }, 60000)

  it('generate exits 0 and reports 9 harnesses with all adapter names', () => {
    const dir = tmpPluginDir()
    const result = runCli(['generate'], dir)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Generated')
    expect(result.stdout).toContain('9 harness')
    expect(result.stdout).toContain('claude-code')
    expect(result.stdout).toContain('cursor')
    expect(result.stdout).toContain('codex')
    expect(result.stdout).toContain('devin')
    expect(result.stdout).toContain('kimi')
    expect(result.stdout).toContain('gemini')
    expect(result.stdout).toContain('opencode')
    expect(result.stdout).toContain('agent-plugins-1.0')
    expect(result.stdout).toContain('agents-marketplace')
  })

  it('validate on a freshly generated plugin exits 0 clean', () => {
    const dir = tmpPluginDir()
    runCli(['generate'], dir)
    const result = runCli(['validate'], dir)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('validate: clean')
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
    const countIndex = result.stdout.indexOf('Pruned 2 stale file(s)')
    expect(geminiExtIndex).toBeGreaterThanOrEqual(0)
    expect(geminiMdIndex).toBeGreaterThanOrEqual(0)
    expect(countIndex).toBeGreaterThan(geminiExtIndex)
    expect(countIndex).toBeGreaterThan(geminiMdIndex)
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
})
