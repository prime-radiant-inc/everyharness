import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { ConfigError, loadConfig, VERSION_RE, VERSION_MESSAGE, type EveryharnessConfig } from './config.js'
import { readField, writeField } from './field-edit.js'
import { generate, type GenerateResult } from './generate.js'
import { checkDrift, loadManifest, MANIFEST_PATH } from './manifest.js'

// `everyharness bump` is the replacement for hand-rolled per-repo version-bump
// scripts (e.g. superpowers' scripts/bump-version.sh + .version-bump.json).
// everyharness.yaml is the version source of truth; `bump.files` names the
// extra, non-generated files that also carry the version, and the audit sweeps
// for occurrences nobody declared.

const CONFIG_FILE = 'everyharness.yaml'

// Directories never worth walking during an audit, independent of the
// configured excludes (mirrors bump-version.sh's always-on --exclude-dir).
const ALWAYS_EXCLUDED_DIRS = ['.git', 'node_modules']

// Files past this size still get their first 8KB sniffed for a null byte;
// only the sniff window is bounded, not the files considered.
const BINARY_SNIFF_BYTES = 8192

export interface BumpFileChange {
  path: string
  field: string
  status: 'bumped' | 'skipped'
  // Present only when status is 'bumped'.
  oldVersion?: string
  newVersion: string
}

export interface BumpResult {
  newVersion: string
  configOldVersion: string
  files: BumpFileChange[]
  generate: GenerateResult
  audit: AuditResult
}

export interface CheckFileStatus {
  path: string
  field: string
  // Undefined when the declared file is missing from disk.
  version?: string
}

export interface CheckResult {
  files: CheckFileStatus[]
  configVersion: string
  // Generated files that no longer match the manifest (missing or modified).
  staleGenerated: string[]
  drift: boolean
}

export interface AuditFinding {
  path: string
  line: number
  text: string
}

export interface AuditResult {
  version: string
  findings: AuditFinding[]
  clean: boolean
}

// bump + regenerate + audit. everyharness.yaml and every declared file are
// rewritten to newVersion, then `generate` rebuilds the harness manifests from
// the now-bumped yaml, then the audit sweeps for stray occurrences.
export function bumpVersion(root: string, newVersion: string): BumpResult {
  if (!VERSION_RE.test(newVersion)) {
    throw new ConfigError(`invalid version "${newVersion}": ${VERSION_MESSAGE}`)
  }
  const config = loadConfig(root)
  const declared = config.bump?.files ?? []

  // Preflight: every declared file that exists must be readable. Collect all
  // failures and report them together before mutating anything on disk.
  const preflightErrors: string[] = []
  for (const entry of declared) {
    const abs = join(root, entry.path)
    if (!existsSync(abs)) continue
    try {
      readField(abs, entry.field)
    } catch (e) {
      if (e instanceof ConfigError) preflightErrors.push(e.message)
      else throw e
    }
  }
  if (preflightErrors.length > 0) {
    throw new ConfigError('cannot bump: declared bump.files are not all readable', preflightErrors)
  }

  const files: BumpFileChange[] = []
  for (const entry of declared) {
    const abs = join(root, entry.path)
    if (!existsSync(abs)) {
      files.push({ path: entry.path, field: entry.field, status: 'skipped', newVersion })
      continue
    }
    const oldVersion = readField(abs, entry.field)
    writeField(abs, entry.field, newVersion)
    files.push({ path: entry.path, field: entry.field, status: 'bumped', oldVersion, newVersion })
  }

  const configPath = join(root, CONFIG_FILE)
  const configOldVersion = readField(configPath, 'version')
  writeField(configPath, 'version', newVersion)

  const generateResult = generate(root)
  const audit = bumpAudit(root)

  return { newVersion, configOldVersion, files, generate: generateResult, audit }
}

// Report the version each declared file (and everyharness.yaml) holds, and
// whether anything has drifted out of sync.
export function bumpCheck(root: string): CheckResult {
  const config = loadConfig(root)
  const files: CheckFileStatus[] = []
  const versions = new Set<string>([config.version])
  let anyMissing = false

  for (const entry of config.bump?.files ?? []) {
    const abs = join(root, entry.path)
    if (!existsSync(abs)) {
      files.push({ path: entry.path, field: entry.field })
      anyMissing = true
      continue
    }
    const version = readField(abs, entry.field)
    files.push({ path: entry.path, field: entry.field, version })
    versions.add(version)
  }

  const drift = checkDrift(root)
  const staleGenerated = [...drift.missing, ...drift.modified].sort()

  return {
    files,
    configVersion: config.version,
    staleGenerated,
    drift: versions.size > 1 || anyMissing || staleGenerated.length > 0,
  }
}

// Sweep the repo for the current version string and report occurrences in
// files nobody accounts for: not declared in bump.files, not everyharness.yaml,
// not a generated file, and not matched by a bump.audit.exclude pattern.
export function bumpAudit(root: string): AuditResult {
  const config = loadConfig(root)
  const version = config.version
  const accounted = accountedPaths(root, config)
  const patterns = config.bump?.audit?.exclude ?? []

  const findings: AuditFinding[] = []
  for (const rel of walkFiles(root, patterns)) {
    if (accounted.has(rel)) continue
    const buf = readFileSync(join(root, rel))
    if (isBinary(buf)) continue
    const lines = buf.toString('utf8').split('\n')
    lines.forEach((line, i) => {
      if (line.includes(version)) findings.push({ path: rel, line: i + 1, text: line.trim() })
    })
  }

  return { version, findings, clean: findings.length === 0 }
}

// Paths whose version string is expected and must never be flagged: the config
// itself, the manifest, every declared bump file, and every generated file the
// manifest records.
function accountedPaths(root: string, config: EveryharnessConfig): Set<string> {
  const accounted = new Set<string>([CONFIG_FILE, MANIFEST_PATH])
  for (const entry of config.bump?.files ?? []) accounted.add(entry.path)
  const manifest = loadManifest(root)
  if (manifest) for (const path of Object.keys(manifest.files)) accounted.add(path)
  return accounted
}

// Repo-relative file paths, pruning .git/node_modules always and any directory
// or file matched by an exclude pattern (mirroring grep --exclude-dir/--exclude).
function walkFiles(root: string, patterns: string[]): string[] {
  const out: string[] = []
  const recur = (dir: string): void => {
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, dirent.name)
      const rel = relative(root, abs).split(sep).join('/')
      if (dirent.isDirectory()) {
        if (ALWAYS_EXCLUDED_DIRS.includes(dirent.name)) continue
        if (matchesExclude(rel, patterns)) continue
        recur(abs)
      } else if (dirent.isFile()) {
        if (matchesExclude(rel, patterns)) continue
        out.push(rel)
      }
    }
  }
  recur(root)
  return out
}

// grep's --exclude/--exclude-dir match a glob against a single name, not the
// whole path — so a pattern matches when it globs the basename or any single
// path segment.
function matchesExclude(rel: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false
  const segments = rel.split('/')
  return patterns.some((pattern) => {
    const re = globToRegExp(pattern)
    return segments.some((segment) => re.test(segment))
  })
}

function globToRegExp(pattern: string): RegExp {
  let body = ''
  for (const ch of pattern) {
    if (ch === '*') body += '[^/]*'
    else if (ch === '?') body += '[^/]'
    else body += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${body}$`)
}

function isBinary(buf: Buffer): boolean {
  const end = Math.min(buf.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < end; i++) {
    if (buf[i] === 0) return true
  }
  return false
}
