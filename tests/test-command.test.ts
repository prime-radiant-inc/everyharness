import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from '../src/generate.js'
import { runTest, DEFAULT_IMAGE } from '../src/test-command.js'
import { ConfigError } from '../src/config.js'

// dist/cli.js is built once via tests/global-setup.ts (vitest globalSetup),
// before any test file runs — same convention as tests/cli.test.ts.
const REPO_ROOT = process.cwd()
const CLI = join(REPO_ROOT, 'dist', 'cli.js')
const CHECKS_SCRIPT = join(REPO_ROOT, 'checks', 'run-checks.sh')

function freshKitchenSink(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eh-test-cmd-'))
  cpSync(join(REPO_ROOT, 'fixtures', 'kitchen-sink'), dir, { recursive: true })
  return dir
}

// A generated plugin root (manifest present) — what `everyharness test`
// requires before it will even look for docker.
function generatedKitchenSink(): string {
  const dir = freshKitchenSink()
  generate(dir)
  return dir
}

// An empty directory on PATH: simulates a machine with no docker installed,
// without touching the real PATH permanently.
function emptyBin(): string {
  return mkdtempSync(join(tmpdir(), 'eh-empty-bin-'))
}

// A temp bin directory containing an executable `docker` shim that records
// its full argv (one token per line) to argvFile and exits with
// DOCKER_SHIM_EXIT_CODE (default 0) — lets the docker-invocation tests
// assert on the exact command line runTest() built and drive the exit-code
// mapping without a real docker daemon. Shebang is an absolute path
// (/bin/bash, not `env bash`) so the shim still runs when PATH has been
// narrowed down to just this directory.
function dockerShimBin(argvFile: string): string {
  const bin = mkdtempSync(join(tmpdir(), 'eh-docker-shim-'))
  const script = ['#!/bin/bash', `printf '%s\\n' "$@" > "${argvFile}"`, 'exit "${DOCKER_SHIM_EXIT_CODE:-0}"', ''].join(
    '\n',
  )
  const dockerPath = join(bin, 'docker')
  writeFileSync(dockerPath, script)
  chmodSync(dockerPath, 0o755)
  return bin
}

describe('runTest', () => {
  const savedPath = process.env.PATH
  const savedExitCode = process.env.DOCKER_SHIM_EXIT_CODE

  afterEach(() => {
    if (savedPath === undefined) delete process.env.PATH
    else process.env.PATH = savedPath
    if (savedExitCode === undefined) delete process.env.DOCKER_SHIM_EXIT_CODE
    else process.env.DOCKER_SHIM_EXIT_CODE = savedExitCode
  })

  it('throws ConfigError when there is no generation manifest', () => {
    const dir = freshKitchenSink() // no generate() run: no .everyharness/manifest.json
    expect(() => runTest(dir)).toThrowError(ConfigError)
    expect(() => runTest(dir)).toThrowError(/run everyharness generate first/)
  })

  it('rejects with ConfigError when docker is not on PATH', async () => {
    const dir = generatedKitchenSink()
    process.env.PATH = emptyBin()
    await expect((async () => runTest(dir))()).rejects.toThrowError(ConfigError)
    await expect((async () => runTest(dir))()).rejects.toThrowError(/docker is required/)
  })

  it('invokes docker with --rm, both read-only mounts, EH_PLUGIN_NAME, and the default image', async () => {
    const dir = generatedKitchenSink()
    const argvFile = join(mkdtempSync(join(tmpdir(), 'eh-argv-')), 'argv.txt')
    process.env.PATH = dockerShimBin(argvFile)

    const result = await runTest(dir)

    expect(result.exitCode).toBe(0)
    const argv = readFileSync(argvFile, 'utf8').split('\n').filter(Boolean)
    expect(argv).toContain('run')
    expect(argv).toContain('--rm')
    expect(argv).toContain('-e')
    expect(argv).toContain('EH_PLUGIN_NAME=kitchen-sink')
    expect(argv.some((a) => a.endsWith(':/plugin:ro'))).toBe(true)
    expect(argv.some((a) => a.endsWith(':/checks:ro'))).toBe(true)
    expect(argv).toContain(DEFAULT_IMAGE)
  })

  it('maps docker exit 0 to exitCode 0', async () => {
    const dir = generatedKitchenSink()
    const argvFile = join(mkdtempSync(join(tmpdir(), 'eh-argv-')), 'argv.txt')
    process.env.PATH = dockerShimBin(argvFile)
    process.env.DOCKER_SHIM_EXIT_CODE = '0'

    const result = await runTest(dir)
    expect(result.exitCode).toBe(0)
  })

  it('maps docker exit 3 (checks script found a failure) to exitCode 2', async () => {
    const dir = generatedKitchenSink()
    const argvFile = join(mkdtempSync(join(tmpdir(), 'eh-argv-')), 'argv.txt')
    process.env.PATH = dockerShimBin(argvFile)
    process.env.DOCKER_SHIM_EXIT_CODE = '3'

    const result = await runTest(dir)
    expect(result.exitCode).toBe(2)
  })

  it('maps docker exit 1 (docker itself failed, e.g. daemon down) to a ConfigError', async () => {
    const dir = generatedKitchenSink()
    const argvFile = join(mkdtempSync(join(tmpdir(), 'eh-argv-')), 'argv.txt')
    process.env.PATH = dockerShimBin(argvFile)
    process.env.DOCKER_SHIM_EXIT_CODE = '1'

    await expect((async () => runTest(dir))()).rejects.toThrowError(ConfigError)
    await expect((async () => runTest(dir))()).rejects.toThrowError(/docker invocation failed \(exit 1\)/)
  })

  it('maps docker exit 127 (invocation error) to a ConfigError', async () => {
    const dir = generatedKitchenSink()
    const argvFile = join(mkdtempSync(join(tmpdir(), 'eh-argv-')), 'argv.txt')
    process.env.PATH = dockerShimBin(argvFile)
    process.env.DOCKER_SHIM_EXIT_CODE = '127'

    await expect((async () => runTest(dir))()).rejects.toThrowError(ConfigError)
  })
})

describe('checks/run-checks.sh', () => {
  it('is syntactically valid bash', () => {
    const result = spawnSync('bash', ['-n', CHECKS_SCRIPT], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('is shellcheck-clean, when shellcheck is installed', () => {
    const result = spawnSync('shellcheck', [CHECKS_SCRIPT], { encoding: 'utf8' })
    if (result.error) {
      console.warn('shellcheck not installed; skipping lint of checks/run-checks.sh')
      return
    }
    expect(result.stdout + result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  // Runs the script directly (no container) against a generated kitchen-sink
  // copy, exercising the manifest-harness jq logic (and every other check
  // that only needs bash/jq/node/python3, all present on this machine) end
  // to end. bun may or may not be installed here; either way the pi check's
  // FALLBACK-file-presence path keeps this green, and any other genuinely
  // absent tool (e.g. claude, gemini) degrades to a `skip` line rather than
  // a failure — so this assertion holds on any dev machine or CI runner.
  // 30s timeout: the script shells out to real claude/gemini binaries when
  // present, which can be slow under full-suite CPU contention.
  it('exits 0 with an "ok codex:" line and no "not ok" lines against a generated kitchen-sink plugin', () => {
    const dir = generatedKitchenSink()
    const result = spawnSync('bash', [CHECKS_SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, EH_PLUGIN_NAME: 'kitchen-sink', EH_PLUGIN_ROOT: dir },
    })
    expect(result.stdout).toContain('ok codex:')
    expect(result.stdout).not.toMatch(/^not ok /m)
    expect(result.status).toBe(0)
  }, 30_000)

  // Corrupting a generated manifest into invalid JSON forces a "not ok" line
  // (check_manifest_harness's `jq empty` fails), which must produce the
  // distinctive exit 3 — not the generic exit 1 that a docker daemon-down
  // failure also produces — so src/test-command.ts can tell the two apart.
  it('exits 3 when a generated manifest is corrupted, with a matching "not ok" line', () => {
    const dir = generatedKitchenSink()
    writeFileSync(join(dir, '.codex-plugin', 'plugin.json'), '{not valid json')
    const result = spawnSync('bash', [CHECKS_SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, EH_PLUGIN_NAME: 'kitchen-sink', EH_PLUGIN_ROOT: dir },
    })
    expect(result.stdout).toContain('not ok codex:')
    expect(result.status).toBe(3)
  })
})

describe('CLI test command e2e', () => {
  it('exits 0 when the checks script passes (docker shim exit 0)', () => {
    const dir = generatedKitchenSink()
    const argvFile = join(mkdtempSync(join(tmpdir(), 'eh-argv-')), 'argv.txt')
    const bin = dockerShimBin(argvFile)

    const result = spawnSync(process.execPath, [CLI, 'test'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: bin },
    })

    expect(result.status).toBe(0)
  })

  it('exits 2 when the checks script fails (docker shim exit 3)', () => {
    const dir = generatedKitchenSink()
    const argvFile = join(mkdtempSync(join(tmpdir(), 'eh-argv-')), 'argv.txt')
    const bin = dockerShimBin(argvFile)

    const result = spawnSync(process.execPath, [CLI, 'test'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: bin, DOCKER_SHIM_EXIT_CODE: '3' },
    })

    expect(result.status).toBe(2)
  })

  it('exits 1 with a config error when docker itself fails (docker shim exit 1, e.g. daemon down)', () => {
    const dir = generatedKitchenSink()
    const argvFile = join(mkdtempSync(join(tmpdir(), 'eh-argv-')), 'argv.txt')
    const bin = dockerShimBin(argvFile)

    const result = spawnSync(process.execPath, [CLI, 'test'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: bin, DOCKER_SHIM_EXIT_CODE: '1' },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('docker invocation failed (exit 1)')
  })

  it('exits 1 with a config error when docker is missing from PATH', () => {
    const dir = generatedKitchenSink()

    const result = spawnSync(process.execPath, [CLI, 'test'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: emptyBin() },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('docker is required')
  })

  it('exits 1 with a config error when there is no generation manifest', () => {
    const dir = freshKitchenSink() // no generate() run

    const result = spawnSync(process.execPath, [CLI, 'test'], {
      cwd: dir,
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('run everyharness generate first')
  })
})
