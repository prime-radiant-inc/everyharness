import { describe, it, expect } from 'vitest'
import { adapters } from '../../src/adapters/index.js'
import { ADAPTER_NAMES } from '../../src/config.js'

// config.ts duplicates the adapter-name list (ADAPTER_NAMES) because it cannot
// import the live registry from src/adapters/index.ts without an import cycle.
// This test is the tripwire that keeps the duplicate honest: if an adapter is
// added, removed, or renamed, ADAPTER_NAMES must be updated in lockstep or the
// harness-name validation in loadConfig goes wrong (rejecting a real harness or
// accepting a typo).
describe('adapter-name registry', () => {
  it('ADAPTER_NAMES in config.ts matches the live adapters array exactly', () => {
    expect([...ADAPTER_NAMES]).toEqual(adapters.map((a) => a.name))
  })
})
