import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ajv } from 'ajv'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { checkDrift, type DriftReport } from './manifest.js'

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas')

// Which generated files are schema-checked, by which vendored schema, and
// under which JSON Schema dialect. .codex-plugin/plugin.json is deliberately
// NOT schema-validated: SchemaStore's codex schema (checked 2026-08-11) is
// closed, omits the load-bearing hooks:{} field, and requires portal
// interface metadata — it rejects known-good manifests (including
// superpowers' own). Emission correctness is pinned by exact-content tests
// in tests/adapters/codex.test.ts.
const SCHEMA_TARGETS: Array<{ file: string; schema: string; dialect: 'draft7' | '2020' }> = [
  { file: '.claude-plugin/plugin.json', schema: 'claude-code-plugin-manifest.json', dialect: 'draft7' },
  { file: 'plugin.json', schema: 'agent-plugins-plugin.schema.json', dialect: '2020' },
  { file: 'mcp.json', schema: 'agent-plugins-mcp.schema.json', dialect: '2020' },
]

export interface ValidateResult {
  drift: DriftReport
  schemaErrors: string[]
  ok: boolean
}

export function validate(root: string): ValidateResult {
  const drift = checkDrift(root)
  const ajv = new Ajv({ strict: false, allErrors: true, logger: false })
  const ajv2020 = new Ajv2020({ strict: false, allErrors: true, logger: false })
  const schemaErrors: string[] = []
  for (const target of SCHEMA_TARGETS) {
    const filePath = join(root, target.file)
    if (!existsSync(filePath)) continue
    const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, target.schema), 'utf8'))
    const check = (target.dialect === '2020' ? ajv2020 : ajv).compile(schema)
    let data: unknown
    try {
      data = JSON.parse(readFileSync(filePath, 'utf8'))
    } catch (e) {
      schemaErrors.push(`${target.file}: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }
    if (!check(data)) {
      for (const err of check.errors ?? []) {
        schemaErrors.push(`${target.file}${err.instancePath}: ${err.message}`)
      }
    }
  }
  return { drift, schemaErrors, ok: drift.clean && schemaErrors.length === 0 }
}
