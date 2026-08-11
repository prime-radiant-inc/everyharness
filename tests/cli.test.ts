import { describe, it, expect, beforeAll } from 'vitest'
import { execSync, spawnSync } from 'node:child_process'
import { mkdtempSync, cpSync, writeFileSync } from 'node:fs'
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

  it('generate exits 0 and reports files generated', () => {
    const dir = tmpPluginDir()
    const result = runCli(['generate'], dir)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Generated')
  })

  it('validate on a freshly generated plugin exits 2 with the known codex/SchemaStore schema gap', () => {
    // See tests/validate.test.ts: the vendored codex schema doesn't model
    // the `hooks: {}` escape hatch Design decision 8 requires, and
    // kitchen-sink has no harnesses.overrides.codex.interface either, so
    // .codex-plugin/plugin.json legitimately fails schema validation.
    const dir = tmpPluginDir()
    runCli(['generate'], dir)
    const result = runCli(['validate'], dir)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("schema: .codex-plugin/plugin.json: must have required property 'interface'")
    expect(result.stderr).toContain('schema: .codex-plugin/plugin.json: must NOT have additional properties')
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
})
