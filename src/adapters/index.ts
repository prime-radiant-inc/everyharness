import type { HarnessAdapter } from './types.js'
import { claudeCode } from './claude-code.js'
import { cursor } from './cursor.js'
import { codex } from './codex.js'
import { devin } from './devin.js'
import { kimi } from './kimi.js'
import { gemini } from './gemini.js'
import { opencode } from './opencode.js'
import { pi } from './pi.js'
import { hermes } from './hermes.js'
import { agentPlugins } from './agent-plugins.js'
import { agentsMarketplace } from './agents-marketplace.js'

export type { SupportLevel, ComponentSupport, EmitResult, HarnessAdapter } from './types.js'

export const adapters: HarnessAdapter[] = [claudeCode, cursor, codex, devin, kimi, gemini, opencode, pi, hermes, agentPlugins, agentsMarketplace]

export function getAdapter(name: string): HarnessAdapter | undefined {
  return adapters.find((a) => a.name === name)
}
