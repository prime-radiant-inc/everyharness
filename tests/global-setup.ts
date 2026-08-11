import { execSync } from 'node:child_process'

// Runs exactly once per `vitest run`/`vitest` invocation, before any test
// file starts. cli.test.ts, init.test.ts, and import.test.ts each spawn the
// built dist/cli.js; they used to run `npm run build` in their own per-file
// beforeAll, which raced when vitest ran those files in parallel workers
// (concurrent `tsc` invocations stomping on the same dist/ output). Building
// here instead guarantees dist/ is ready before any test file's code runs.
export default function setup(): void {
  execSync('npm run build', { stdio: 'inherit' })
}
