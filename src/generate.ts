import { buildModel } from './model.js'
import { writeFileSet, type FileSet } from './fileset.js'
import { saveManifest } from './manifest.js'
import { adapters } from './adapters/index.js'
import { ConfigError } from './config.js'

export const TOOL_VERSION = '0.1.0'

export interface GenerateResult {
  files: FileSet
  warnings: string[]
  adaptersRun: string[]
}

export function generate(root: string): GenerateResult {
  const model = buildModel(root)
  const excluded = new Set(model.config.harnesses.exclude)
  const active = adapters.filter((a) => !excluded.has(a.name))

  const files: FileSet = []
  const warnings: string[] = []
  const owners = new Map<string, string>()
  for (const adapter of active) {
    const result = adapter.emit(model)
    for (const file of result.files) {
      const owner = owners.get(file.path)
      if (owner) {
        throw new ConfigError(
          `adapters "${owner}" and "${adapter.name}" both emit ${file.path}`,
        )
      }
      owners.set(file.path, adapter.name)
      files.push(file)
    }
    warnings.push(...result.warnings.map((w) => `[${adapter.name}] ${w}`))
  }

  writeFileSet(root, files)
  saveManifest(root, files, TOOL_VERSION)
  return { files, warnings, adaptersRun: active.map((a) => a.name) }
}
