import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import { ConfigError } from './config.js'

export interface GeneratedFile {
  path: string
  content: string
  executable?: boolean
}
export type FileSet = GeneratedFile[]

export function writeFileSet(root: string, files: FileSet): void {
  const rootAbs = resolve(root)
  const resolved = files.map((file) => {
    if (isAbsolute(file.path)) {
      throw new ConfigError(`generated file path must be relative to plugin root: ${file.path}`)
    }
    const abs = resolve(root, file.path)
    if (!abs.startsWith(rootAbs + sep)) {
      throw new ConfigError(`generated file path escapes plugin root: ${file.path}`)
    }
    return { file, abs }
  })
  for (const { file, abs } of resolved) {
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, file.content)
    if (file.executable) chmodSync(abs, 0o755)
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Deep-merges two objects. For each key in override:
 * - If the value is `null`, the key is deleted from the result (delete sentinel).
 * - If both base and override values are plain objects, recurse.
 * - Otherwise, replace the base value with the override value.
 *
 * Note: A literal null can no longer be set via overrides as a value; `null` is
 * treated as a delete sentinel. This is a deliberate trade-off to enable removal
 * of inherited fields.
 */
export function deepMerge(base: unknown, override: unknown): unknown {
  // If override is not an object, just return it
  if (!isPlainObject(override)) return override

  // Override is a plain object; start with base if it's also a plain object
  let out: Record<string, unknown>
  if (isPlainObject(base)) {
    out = { ...base }
  } else {
    out = {}
  }

  // Process override keys, applying null delete logic
  for (const [key, value] of Object.entries(override)) {
    if (value === null) {
      delete out[key]
    } else {
      out[key] = key in out ? deepMerge(out[key], value) : value
    }
  }
  return out
}
