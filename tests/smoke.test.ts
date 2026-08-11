import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs TypeScript tests', () => {
    const answer: number = 42
    expect(answer).toBe(42)
  })
})

describe('version consistency', () => {
  it('TOOL_VERSION matches package.json', async () => {
    const { TOOL_VERSION } = await import('../src/generate.js')
    const { readFileSync } = await import('node:fs')
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
    expect(TOOL_VERSION).toBe(pkg.version)
  })
})
