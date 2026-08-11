import type { HarnessAdapter } from './types.js'
import { claudeCode } from './claude-code.js'
import { cursor } from './cursor.js'
import { codex } from './codex.js'
import { devin } from './devin.js'
import { kimi } from './kimi.js'
import { gemini } from './gemini.js'

export type { SupportLevel, ComponentSupport, EmitResult, HarnessAdapter } from './types.js'

export const adapters: HarnessAdapter[] = [claudeCode, cursor, codex, devin, kimi, gemini]

export function getAdapter(name: string): HarnessAdapter | undefined {
  return adapters.find((a) => a.name === name)
}
