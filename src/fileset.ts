import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface GeneratedFile {
  path: string
  content: string
  executable?: boolean
}
export type FileSet = GeneratedFile[]

export function writeFileSet(root: string, files: FileSet): void {
  for (const file of files) {
    const abs = join(root, file.path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, file.content)
    if (file.executable) chmodSync(abs, 0o755)
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in out ? deepMerge(out[key], value) : value
  }
  return out
}
