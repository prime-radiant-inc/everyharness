import type { HarnessAdapter } from './types.js'
import { claudeCode } from './claude-code.js'
import { cursor } from './cursor.js'

export type { SupportLevel, ComponentSupport, EmitResult, HarnessAdapter } from './types.js'

export const adapters: HarnessAdapter[] = [claudeCode, cursor]

export function getAdapter(name: string): HarnessAdapter | undefined {
  return adapters.find((a) => a.name === name)
}
