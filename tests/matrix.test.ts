import { describe, it, expect } from 'vitest'
import { renderMatrix } from '../src/matrix.js'

describe('renderMatrix', () => {
  it('renders one row per adapter with all component columns', () => {
    const out = renderMatrix()
    expect(out).toContain('| Harness |')
    expect(out).toContain('| skills |')
    // header + separator + at least the claude-code row
    expect(out).toMatch(/\| claude-code \|( full \|){6}/)
  })
})
