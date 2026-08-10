import { adapters } from './adapters/index.js'
import type { ComponentSupport } from './adapters/types.js'

const COLUMNS: Array<keyof ComponentSupport> = [
  'skills',
  'commands',
  'agents',
  'hooks',
  'mcp',
  'bootstrap',
]

export function renderMatrix(): string {
  const header = `| Harness | ${COLUMNS.join(' | ')} |`
  const separator = `|${'---|'.repeat(COLUMNS.length + 1)}`
  const rows = adapters.map(
    (a) => `| ${a.name} | ${COLUMNS.map((c) => a.support[c]).join(' | ')} |`,
  )
  return [header, separator, ...rows].join('\n') + '\n'
}
