import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ajv } from 'ajv'
import { checkDrift, type DriftReport } from './manifest.js'

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas')

// Which generated files are schema-checked, and by which vendored schema.
const SCHEMA_TARGETS: Array<{ file: string; schema: string }> = [
  { file: '.claude-plugin/plugin.json', schema: 'claude-code-plugin-manifest.json' },
]

export interface ValidateResult {
  drift: DriftReport
  schemaErrors: string[]
  ok: boolean
}

export function validate(root: string): ValidateResult {
  const drift = checkDrift(root)
  const ajv = new Ajv({ strict: false, allErrors: true })
  const schemaErrors: string[] = []
  for (const target of SCHEMA_TARGETS) {
    const filePath = join(root, target.file)
    if (!existsSync(filePath)) continue
    const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, target.schema), 'utf8'))
    const check = ajv.compile(schema)
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
