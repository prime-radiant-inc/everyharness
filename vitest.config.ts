import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // See tests/global-setup.ts: builds dist/ once before any test file
    // runs, so the CLI-spawning test files don't each build it themselves.
    globalSetup: ['./tests/global-setup.ts'],
  },
})
