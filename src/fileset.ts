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

export function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in out ? deepMerge(out[key], value) : value
  }
  return out
}
