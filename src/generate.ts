import { rmSync, rmdirSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve, isAbsolute, sep } from 'node:path'
import { buildModel } from './model.js'
import { writeFileSet, type FileSet, type GeneratedFile } from './fileset.js'
import { saveManifest, loadManifest, sha256 } from './manifest.js'
import { adapters, type HarnessAdapter } from './adapters/index.js'
import { ConfigError, type EveryharnessConfig } from './config.js'

export const TOOL_VERSION = '0.2.0'

export interface GenerateResult {
  files: FileSet
  warnings: string[]
  adaptersRun: string[]
  pruned: string[]
}

function isSourcePath(path: string, config: EveryharnessConfig): boolean {
  if (path === 'everyharness.yaml') return true
  if (path === config.components.hooks || path === config.components.mcp) return true
  for (const dir of [config.components.skills, config.components.commands, config.components.agents]) {
    if (path === dir || path.startsWith(`${dir}/`)) return true
  }
  return false
}

export function generate(root: string, adapterList: HarnessAdapter[] = adapters): GenerateResult {
  const model = buildModel(root)
  const excluded = new Set(model.config.harnesses.exclude)
  const active = adapterList.filter((a) => !excluded.has(a.name))

  const warnings: string[] = []
  const byPath = new Map<string, { owner: string; file: GeneratedFile }>()
  for (const adapter of active) {
    const result = adapter.emit(model)
    for (const file of result.files) {
      if (isSourcePath(file.path, model.config)) {
        throw new ConfigError(`adapter "${adapter.name}" would overwrite source file ${file.path}`)
      }
      const existing = byPath.get(file.path)
      if (existing) {
        const identical =
          existing.file.content === file.content &&
          Boolean(existing.file.executable) === Boolean(file.executable)
        if (!identical) {
          throw new ConfigError(`adapters "${existing.owner}" and "${adapter.name}" both emit ${file.path}`)
        }
        continue // identical content: dedupe silently
      }
      byPath.set(file.path, { owner: adapter.name, file })
    }
    warnings.push(...result.warnings.map((w) => `[${adapter.name}] ${w}`))
  }
  const files: FileSet = [...byPath.values()].map((v) => v.file)

  const prior = loadManifest(root)
  const pruned: string[] = []
  if (prior) {
    const newPaths = new Set(files.map((f) => f.path))
    const rootAbs = resolve(root)
    for (const [path, entry] of Object.entries(prior.files)) {
      if (newPaths.has(path)) continue

      // Skip and warn if path is unsafe (absolute or escapes root)
      if (isAbsolute(path)) {
        warnings.push(`ignoring manifest entry with unsafe path ${path}`)
        continue
      }
      const abs = resolve(root, path)
      if (!abs.startsWith(rootAbs + sep)) {
        warnings.push(`ignoring manifest entry with unsafe path ${path}`)
        continue
      }

      if (!existsSync(abs)) continue
      if (sha256(readFileSync(abs, 'utf8')) === entry.sha256) {
        rmSync(abs)
        pruned.push(path)
        let parent = dirname(abs)
        while (resolve(parent) !== rootAbs && existsSync(parent) && readdirSync(parent).length === 0) {
          rmdirSync(parent)
          parent = dirname(parent)
        }
      } else {
        warnings.push(`stale generated file ${path} was hand-modified; delete it or move changes into everyharness.yaml`)
      }
    }
  }

  writeFileSet(root, files)
  saveManifest(root, files, TOOL_VERSION)
  return { files, warnings, adaptersRun: active.map((a) => a.name), pruned }
}
