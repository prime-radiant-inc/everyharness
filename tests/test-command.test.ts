import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
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

// Every harness the deep install-verification tier reports an install-<name>
// line for — exactly the harnesses named in checks/run-checks.sh's deep tier.
const DEEP_HARNESSES = [
  'claude-code',
  'gemini',
  'codex',
  'copilot',
  'opencode',
  'grok',
  'droid',
  'hermes',
  'pi',
  'kimi',
  'cursor',
  'devin',
]

// A bin directory holding symlinks to ONLY the generic tools the checks
// script needs (bash, git, jq, node, python3, coreutils) — deliberately
// none of the harness CLIs (claude, codex, gemini, opencode, …). Running the
// script with PATH narrowed to this makes every harness binary "absent",
// which is (a) how a clean CI runner without harness CLIs behaves and (b)
// what keeps the deep tier from firing real, mutating installs against the
// dev machine's own ~/.claude etc. during the unit suite. The deep checks
// therefore all degrade to `skip`, deterministically, on any host.
function sandboxBin(): string {
  const bin = mkdtempSync(join(tmpdir(), 'eh-sandbox-bin-'))
  const tools = [
    'bash',
    'sh',
    'jq',
    'node',
    'python3',
    'git',
    'cp',
    'mktemp',
    'basename',
    'dirname',
    'mkdir',
    'grep',
    'sort',
    'find',
    'tr',
    'rm',
    'cat',
    'sed',
    'head',
    'tail',
    'env',
    'ls',
    'chmod',
    'uname',
  ]
  const searchDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const tool of tools) {
    for (const dir of searchDirs) {
      const candidate = join(dir, tool)
      if (!existsSync(candidate)) continue
      symlinkSync(candidate, join(bin, tool))
      break
    }
  }
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

  it('oneline() truncates output to 300 characters', () => {
    // Sources the real oneline() out of the script (not a copy) and feeds it
    // output longer than the cap.
    const longString = 'x'.repeat(1000)
    const result = spawnSync(
      'bash',
      ['-c', `eval "$(sed -n "/^oneline()/,/^}/p" "${CHECKS_SCRIPT}")"; output=$(oneline "${longString}"); echo "\${#output}"`],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('300')
  })

  // Sources the real market_name() out of the script (not a copy) and runs it
  // against a descriptor with a custom name — the deep tier's install ids are
  // <plugin>@<marketplace-name>, and that name is now configurable, so the
  // derivation must read the emitted descriptor rather than assume `-dev`.
  it('market_name() reads the descriptor .name, falling back to the passed default when absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-market-name-'))
    mkdirSync(join(dir, '.claude-plugin'))
    const descriptor = join(dir, '.claude-plugin', 'marketplace.json')
    writeFileSync(descriptor, JSON.stringify({ name: 'custom-market', plugins: [{ source: './' }] }))

    const derive = (path: string) =>
      spawnSync(
        'bash',
        ['-c', `eval "$(sed -n "/^market_name()/,/^}/p" "${CHECKS_SCRIPT}")"; market_name "${path}" "fallback-dev"`],
        { encoding: 'utf8' },
      )

    const withName = derive(descriptor)
    expect(withName.status).toBe(0)
    expect(withName.stdout).toBe('custom-market')

    const missing = derive(join(dir, 'does-not-exist.json'))
    expect(missing.status).toBe(0)
    expect(missing.stdout).toBe('fallback-dev')
  })

  // Sources the real rewrite_market_source_local() out of the script. It
  // rewrites every entry source in $WORK/.claude-plugin/marketplace.json to
  // the local "./" form so claude-code/copilot can install offline from the
  // throwaway git-repo copy, regardless of what marketplace.source the config
  // declared (repository/http produce Claude Code's {source:url,url} object,
  // which a real install would otherwise try to network-clone).
  // MARKET_REWRITE_OK records success so callers can skip (not silently pass)
  // on a malformed descriptor.
  it('rewrite_market_source_local() rewrites an object source to "./", flags invalid JSON, and no-ops when the file is absent', () => {
    const runRewrite = (workDir: string) =>
      spawnSync(
        'bash',
        [
          '-c',
          `eval "$(sed -n "/^rewrite_market_source_local()/,/^}/p" "${CHECKS_SCRIPT}")"; MARKET_REWRITE_OK=1; rewrite_market_source_local; echo "$MARKET_REWRITE_OK"`,
        ],
        { encoding: 'utf8', env: { ...process.env, WORK: workDir } },
      )

    // (a) an object (repository) source is rewritten to "./"; the rest of the
    // entry (name, strict, keywords) survives untouched.
    const dirA = mkdtempSync(join(tmpdir(), 'eh-rewrite-a-'))
    mkdirSync(join(dirA, '.claude-plugin'))
    const marketA = join(dirA, '.claude-plugin', 'marketplace.json')
    writeFileSync(
      marketA,
      JSON.stringify({
        name: 'kitchen-sink-market',
        plugins: [
          {
            name: 'kitchen-sink',
            source: { source: 'url', url: 'https://github.com/prime-radiant-inc/everyharness' },
            strict: true,
            keywords: ['demo', 'fixture'],
          },
        ],
      }),
    )
    const resultA = runRewrite(dirA)
    expect(resultA.status).toBe(0)
    expect(resultA.stdout.trim()).toBe('1')
    const rewritten = JSON.parse(readFileSync(marketA, 'utf8'))
    expect(rewritten.plugins[0].source).toBe('./')
    expect(rewritten.plugins[0].name).toBe('kitchen-sink')
    expect(rewritten.plugins[0].strict).toBe(true)
    expect(rewritten.plugins[0].keywords).toEqual(['demo', 'fixture'])

    // (b) invalid JSON sets MARKET_REWRITE_OK=0 (skip, not a silent pass).
    const dirB = mkdtempSync(join(tmpdir(), 'eh-rewrite-b-'))
    mkdirSync(join(dirB, '.claude-plugin'))
    writeFileSync(join(dirB, '.claude-plugin', 'marketplace.json'), '{not valid json')
    const resultB = runRewrite(dirB)
    expect(resultB.status).toBe(0)
    expect(resultB.stdout.trim()).toBe('0')

    // (c) a missing file leaves MARKET_REWRITE_OK at its pre-set 1 (no
    // descriptor to rewrite is not a failure).
    const dirC = mkdtempSync(join(tmpdir(), 'eh-rewrite-c-'))
    const resultC = runRewrite(dirC)
    expect(resultC.status).toBe(0)
    expect(resultC.stdout.trim()).toBe('1')
  })

  // Runs the script directly (no container) against a generated kitchen-sink
  // copy, exercising the manifest-harness jq logic (and every other shallow
  // check that only needs bash/jq/node/python3) end to end. PATH is narrowed
  // to sandboxBin() so no harness CLI is visible: the shallow manifest checks
  // still run (jq-only), and the deep install tier — which performs real,
  // HOME-mutating installs when a harness CLI is present — degrades entirely
  // to `skip` instead of firing against this machine's own ~/.claude. HOME is
  // pointed at a throwaway dir as belt-and-suspenders. Result: deterministic
  // on any host, whether or not it happens to have claude/codex/… installed.
  it('exits 0 with an "ok codex:" line and no "not ok" lines against a generated kitchen-sink plugin', () => {
    const dir = generatedKitchenSink()
    const result = spawnSync('bash', [CHECKS_SCRIPT], {
      encoding: 'utf8',
      env: {
        EH_PLUGIN_NAME: 'kitchen-sink',
        EH_PLUGIN_ROOT: dir,
        PATH: sandboxBin(),
        HOME: mkdtempSync(join(tmpdir(), 'eh-home-')),
      },
    })
    expect(result.stdout).toContain('ok codex:')
    expect(result.stdout).not.toMatch(/^not ok /m)
    expect(result.status).toBe(0)
  }, 30_000)

  // Corrupting a generated manifest into invalid JSON forces a "not ok" line
  // (check_manifest_harness's `jq empty` fails), which must produce the
  // distinctive exit 3 — not the generic exit 1 that a docker daemon-down
  // failure also produces — so src/test-command.ts can tell the two apart.
  // Narrowed PATH (see above) keeps the exit-3 attributable to the corrupt
  // manifest alone, not to a flaky real install.
  it('exits 3 when a generated manifest is corrupted, with a matching "not ok" line', () => {
    const dir = generatedKitchenSink()
    writeFileSync(join(dir, '.codex-plugin', 'plugin.json'), '{not valid json')
    const result = spawnSync('bash', [CHECKS_SCRIPT], {
      encoding: 'utf8',
      env: {
        EH_PLUGIN_NAME: 'kitchen-sink',
        EH_PLUGIN_ROOT: dir,
        PATH: sandboxBin(),
        HOME: mkdtempSync(join(tmpdir(), 'eh-home-')),
      },
    })
    expect(result.stdout).toContain('not ok codex:')
    expect(result.status).toBe(3)
  })

  // --- deep install-verification tier ------------------------------------
  // These assert the tier's structure and its skip contract, running fully
  // offline with every harness CLI made absent via sandboxBin(). The tier's
  // positive path — that a real install makes each CLI enumerate the skills —
  // is verified LIVE against the container image, not here (a fake CLI would
  // only test a mock). What we can and must guarantee on any host: the tier
  // never goes missing and never fails when a CLI simply isn't installed.

  it('emits an install-<harness> line for every harness (ok or skip, never absent)', () => {
    const dir = generatedKitchenSink()
    const result = spawnSync('bash', [CHECKS_SCRIPT], {
      encoding: 'utf8',
      env: {
        EH_PLUGIN_NAME: 'kitchen-sink',
        EH_PLUGIN_ROOT: dir,
        PATH: sandboxBin(),
        HOME: mkdtempSync(join(tmpdir(), 'eh-home-')),
      },
    })
    for (const harness of DEEP_HARNESSES) {
      expect(result.stdout).toMatch(new RegExp(`^(ok|skip) install-${harness}:`, 'm'))
    }
  }, 30_000)

  it('degrades every deep check to skip (never "not ok") when no harness CLI is on PATH, staying exit 0', () => {
    const dir = generatedKitchenSink()
    const result = spawnSync('bash', [CHECKS_SCRIPT], {
      encoding: 'utf8',
      env: {
        EH_PLUGIN_NAME: 'kitchen-sink',
        EH_PLUGIN_ROOT: dir,
        PATH: sandboxBin(),
        HOME: mkdtempSync(join(tmpdir(), 'eh-home-')),
      },
    })
    for (const harness of DEEP_HARNESSES) {
      expect(result.stdout).toMatch(new RegExp(`^skip install-${harness}:`, 'm'))
    }
    expect(result.stdout).not.toMatch(/^not ok install-/m)
    expect(result.status).toBe(0)
  }, 30_000)

  // A plugin with no skills makes the whole deep tier a documented no-op:
  // every harness reports the same "no skills to verify" skip, and nothing
  // is installed. Built as a bare plugin.json so the deep tier's skills scan
  // finds an empty skills root.
  it('skips every deep check with the no-skills reason when the plugin has no skills', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-noskills-'))
    mkdirSync(join(dir, '.claude-plugin'))
    writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'bare', version: '0.1.0' }))
    const result = spawnSync('bash', [CHECKS_SCRIPT], {
      encoding: 'utf8',
      env: {
        EH_PLUGIN_NAME: 'bare',
        EH_PLUGIN_ROOT: dir,
        PATH: sandboxBin(),
        HOME: mkdtempSync(join(tmpdir(), 'eh-home-')),
      },
    })
    for (const harness of DEEP_HARNESSES) {
      expect(result.stdout).toContain(`skip install-${harness}: plugin has no skills to verify`)
    }
    expect(result.status).toBe(0)
  })

  // --- exec-bit preservation sweep (#9) ----------------------------------
  // A skill can ship an executable script; if any harness's install path
  // drops its mode bit the skill dies with "Permission denied" while every
  // other check stays green. deep_exec_bits() discovers every executable file
  // under skills/, verifies the staged copy kept the bit, then reuses each
  // per-harness install to assert the installed copy kept it too.

  // Sources the real discovery helper out of the script (not a copy) and runs
  // it against a tree with one executable and one non-executable skill file:
  // only the executable one is listed, as a path relative to the plugin root.
  it('discover_exec_skill_files() lists executable skill files and ignores non-executable ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-exec-discover-'))
    mkdirSync(join(dir, 'skills', 'greeting', 'scripts'), { recursive: true })
    const exec = join(dir, 'skills', 'greeting', 'scripts', 'hello.sh')
    writeFileSync(exec, '#!/usr/bin/env bash\necho hello\n')
    chmodSync(exec, 0o755)
    const plain = join(dir, 'skills', 'greeting', 'SKILL.md')
    writeFileSync(plain, 'plain\n')
    chmodSync(plain, 0o644)

    const result = spawnSync(
      'bash',
      [
        '-c',
        `eval "$(sed -n "/^discover_exec_skill_files()/,/^}/p" "${CHECKS_SCRIPT}")"; discover_exec_skill_files "${dir}"`,
      ],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('skills/greeting/scripts/hello.sh')
  })

  // A plugin that ships no executable skill files pays exactly one line — the
  // documented single skip — and does no per-harness exec-bit work. Built by
  // stripping the fixture's hello.sh of its mode bit after generation.
  it('emits exactly one "skip exec-bits:" line when the plugin ships no executable skill files', () => {
    const dir = generatedKitchenSink()
    chmodSync(join(dir, 'skills', 'greeting', 'scripts', 'hello.sh'), 0o644)
    const result = spawnSync('bash', [CHECKS_SCRIPT], {
      encoding: 'utf8',
      env: {
        EH_PLUGIN_NAME: 'kitchen-sink',
        EH_PLUGIN_ROOT: dir,
        PATH: sandboxBin(),
        HOME: mkdtempSync(join(tmpdir(), 'eh-home-')),
      },
    })
    const execLines = result.stdout.split('\n').filter((l) => l.includes('exec-bits'))
    expect(execLines).toEqual(['skip exec-bits: plugin ships no executable skill files'])
    expect(result.status).toBe(0)
  }, 30_000)

  // With the kitchen-sink fixture (which now ships an executable hello.sh) and
  // no harness CLI on PATH: the source baseline passes (the staged copy kept
  // the bit) and every per-harness check degrades to a CLI-absent skip,
  // staying exit 0. kimi is skipped as TUI-only; opencode and pi emit no
  // exec-bits line at all (they don't install by copy).
  it('reports ok exec-bits-source plus CLI-absent per-harness skips against the fixture that ships an executable skill script', () => {
    const dir = generatedKitchenSink()
    const result = spawnSync('bash', [CHECKS_SCRIPT], {
      encoding: 'utf8',
      env: {
        EH_PLUGIN_NAME: 'kitchen-sink',
        EH_PLUGIN_ROOT: dir,
        PATH: sandboxBin(),
        HOME: mkdtempSync(join(tmpdir(), 'eh-home-')),
      },
    })
    expect(result.stdout).toMatch(/^ok exec-bits-source: /m)
    for (const harness of ['claude-code', 'gemini', 'codex', 'copilot', 'droid', 'grok', 'hermes']) {
      expect(result.stdout).toMatch(new RegExp(`^skip exec-bits-${harness}: `, 'm'))
    }
    expect(result.stdout).toMatch(/^skip exec-bits-kimi: install is TUI-only/m)
    expect(result.stdout).not.toMatch(/^(ok|skip|not ok) exec-bits-(opencode|pi):/m)
    expect(result.stdout).not.toMatch(/^not ok /m)
    expect(result.status).toBe(0)
  }, 30_000)
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
