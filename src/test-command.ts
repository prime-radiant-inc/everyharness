import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, ConfigError } from './config.js'
import { MANIFEST_PATH } from './manifest.js'

// checks/run-checks.sh ships alongside dist/ in the published package (see
// package.json "files"); resolved relative to this module the same way
// validate.ts locates schemas/.
const CHECKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'checks')

export const DEFAULT_IMAGE = 'ghcr.io/prime-radiant-inc/everyharness-container:latest'

export interface TestOptions {
  image?: string
}

export interface TestResult {
  exitCode: number
  output: string
}

// Runs the container-backed offline install checks (checks/run-checks.sh)
// against a generated plugin: `docker run --rm -e EH_PLUGIN_NAME=<name> -v
// <plugin>:/plugin:ro -v <checks>:/checks:ro <image> bash
// /checks/run-checks.sh`, streaming stdout/stderr through as it runs.
//
// Exit-code mapping: docker exit 0 (all checks passed) -> 0; docker exit 3
// (the checks script found a failing check — a distinctive code chosen so
// it can't collide with docker's own generic exit 1) -> 2; any other
// docker exit status (including docker's own exit 1, e.g. daemon down or
// no socket perms), or a failure to invoke docker at all, -> ConfigError.
export function runTest(root: string, opts: TestOptions = {}): Promise<TestResult> {
  if (!existsSync(join(root, MANIFEST_PATH))) {
    throw new ConfigError('no generation manifest; run everyharness generate first')
  }
  const config = loadConfig(root)
  const image = opts.image ?? DEFAULT_IMAGE
  const pluginRoot = resolve(root)

  const args = [
    'run',
    '--rm',
    '-e',
    `EH_PLUGIN_NAME=${config.name}`,
    '-v',
    `${pluginRoot}:/plugin:ro`,
    '-v',
    `${CHECKS_DIR}:/checks:ro`,
    image,
    'bash',
    '/checks/run-checks.sh',
  ]

  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let settled = false

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      process.stderr.write(chunk)
    })
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      if (err.code === 'ENOENT') {
        reject(
          new ConfigError(
            'docker is required for everyharness test; install docker or run the checks manually (see docs/install/*)',
          ),
        )
      } else {
        reject(err)
      }
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (code === 0) resolvePromise({ exitCode: 0, output })
      else if (code === 3) resolvePromise({ exitCode: 2, output })
      else
        reject(
          new ConfigError(
            `docker invocation failed (exit ${code === null ? 'null, terminated by signal' : code}); is the docker daemon running and the image pullable?`,
          ),
        )
    })
  })
}
