import { createHash } from 'node:crypto'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ConfigError } from './config.js'
import type { FileSet } from './fileset.js'

export const MANIFEST_PATH = '.everyharness/manifest.json'

interface GenerationManifest {
  schema: 1
  tool: string
  files: Record<string, string>
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function saveManifest(root: string, files: FileSet, toolVersion: string): void {
  const manifest: GenerationManifest = {
    schema: 1,
    tool: `everyharness@${toolVersion}`,
    files: Object.fromEntries(
      [...files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => [f.path, sha256(f.content)]),
    ),
  }
  const abs = join(root, MANIFEST_PATH)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, JSON.stringify(manifest, null, 2) + '\n')
}

export interface DriftReport {
  missing: string[]
  modified: string[]
  clean: boolean
}

export function checkDrift(root: string): DriftReport {
  const abs = join(root, MANIFEST_PATH)
  if (!existsSync(abs)) {
    throw new ConfigError(`no generation manifest at ${MANIFEST_PATH} — run \`everyharness generate\` first`)
  }
  const manifest = JSON.parse(readFileSync(abs, 'utf8')) as GenerationManifest
  const missing: string[] = []
  const modified: string[] = []
  for (const [path, hash] of Object.entries(manifest.files)) {
    const filePath = join(root, path)
    if (!existsSync(filePath)) missing.push(path)
    else if (sha256(readFileSync(filePath, 'utf8')) !== hash) modified.push(path)
  }
  return { missing, modified, clean: missing.length === 0 && modified.length === 0 }
}
