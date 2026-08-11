import { rmSync, rmdirSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve, isAbsolute, sep } from 'node:path'
import { buildModel } from './model.js'
import { writeFileSet, type FileSet, type GeneratedFile } from './fileset.js'
import { saveManifest, loadManifest, sha256, type GenerationManifest } from './manifest.js'
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

export function generate(
  root: string,
  adapterList: HarnessAdapter[] = adapters,
  opts: { force?: boolean } = {},
): GenerateResult {
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

  // A corrupt manifest shouldn't dead-end generate the way it does validate:
  // recover by treating this run as if there were no prior manifest at all, and
  // skip pruning (we have no record of what to prune). validate() still fails
  // loudly on the same corruption — regenerating is the recovery path.
  let prior: GenerationManifest | undefined
  try {
    prior = loadManifest(root)
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e
    warnings.push(`ignoring unreadable generation manifest (${e.message}); skipping prune for this run`)
    prior = undefined
  }
  const rootAbs = resolve(root)

  // Refuse to clobber files that already exist on disk but weren't produced by a
  // prior everyharness run — e.g. a hand-written GEMINI.md dropped in before the
  // first `generate`. A file absent from the prior manifest (or with no prior
  // manifest at all) is only a conflict if its content actually differs from what
  // we're about to write; byte-identical files are left alone so a first run
  // right after cloning a repo that already contains generated output succeeds.
  // Note: when the manifest is unreadable, prior is undefined here too, so every
  // pre-existing generated file looks "not created by everyharness" to the check
  // below. Its byte-identical allowance still lets unchanged files pass without
  // --force; files that actually differ correctly require --force, since we can
  // no longer tell "known-generated but hand-edited" apart from "genuinely
  // user-authored" once the manifest recording that is gone.
  const conflicts: string[] = []
  for (const file of files) {
    const abs = resolve(root, file.path)
    if (!existsSync(abs)) continue
    if (prior && Object.prototype.hasOwnProperty.call(prior.files, file.path)) continue
    if (readFileSync(abs, 'utf8') === file.content) continue
    conflicts.push(file.path)
  }
  if (conflicts.length > 0 && !opts.force) {
    throw new ConfigError(
      `refusing to overwrite existing file(s) not created by everyharness: ${conflicts.join(', ')} (re-run with --force to overwrite)`,
    )
  }

  const pruned: string[] = []
  if (prior) {
    const newPaths = new Set(files.map((f) => f.path))
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
