import { readFileSync, writeFileSync } from 'node:fs'
import { extname } from 'node:path'
import { parseDocument } from 'yaml'
import { ConfigError } from './config.js'

// Contract: readField and writeField both require the full field path to
// already exist with a string value. writeField never creates structure —
// it edits an existing field in place and throws ConfigError (naming the
// file and field) for any path that doesn't already resolve: a missing
// segment, an out-of-bounds array index, or a path that runs through an
// existing scalar. This holds identically for JSON and YAML.

// A dotted field path ('plugins.0.version') split into segments, with
// numeric segments converted to array indices.
type Segment = string | number

function parseField(field: string): Segment[] {
  return field.split('.').map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg))
}

function describe(filePath: string, field: string, reason: string): string {
  return `${filePath}: field "${field}": ${reason}`
}

type FileKind = 'json' | 'yaml'

function fileKind(filePath: string, field: string): FileKind {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.json') return 'json'
  if (ext === '.yaml' || ext === '.yml') return 'yaml'
  throw new ConfigError(describe(filePath, field, 'unsupported file type (expected .json, .yaml, or .yml)'))
}

function readText(filePath: string, field: string): string {
  try {
    return readFileSync(filePath, 'utf8')
  } catch (e) {
    throw new ConfigError(describe(filePath, field, `could not read file: ${(e as Error).message}`), [], { cause: e })
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function getIn(data: unknown, segments: Segment[]): unknown {
  let cur: unknown = data
  for (const seg of segments) {
    if (typeof seg === 'number') {
      if (!Array.isArray(cur)) return undefined
      cur = cur[seg]
    } else {
      if (!isRecord(cur)) return undefined
      cur = cur[seg]
    }
  }
  return cur
}

// Navigates to the parent of the final segment and assigns the value there.
// Returns false (rather than throwing) when the path can't be navigated, so
// callers can raise a ConfigError that names both the file and the field.
function setIn(data: unknown, segments: Segment[], value: string): boolean {
  let cur: unknown = data
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    if (typeof seg === 'number') {
      if (!Array.isArray(cur)) return false
      cur = cur[seg]
    } else {
      if (!isRecord(cur)) return false
      cur = cur[seg]
    }
  }
  const last = segments[segments.length - 1]
  if (typeof last === 'number') {
    if (!Array.isArray(cur)) return false
    cur[last] = value
  } else {
    if (!isRecord(cur)) return false
    cur[last] = value
  }
  return true
}

function parseJson(filePath: string, field: string, text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new ConfigError(describe(filePath, field, `not valid JSON: ${(e as Error).message}`), [], { cause: e })
  }
}

function parseYaml(filePath: string, field: string, text: string): ReturnType<typeof parseDocument> {
  const doc = parseDocument(text)
  if (doc.errors.length) {
    throw new ConfigError(describe(filePath, field, `not valid YAML: ${doc.errors[0].message}`), [], {
      cause: doc.errors[0],
    })
  }
  return doc
}

export function readField(filePath: string, field: string): string {
  const kind = fileKind(filePath, field)
  const text = readText(filePath, field)
  const segments = parseField(field)
  const value =
    kind === 'json' ? getIn(parseJson(filePath, field, text), segments) : parseYaml(filePath, field, text).getIn(segments)
  if (value === undefined) {
    throw new ConfigError(describe(filePath, field, 'field not found'))
  }
  if (typeof value !== 'string') {
    throw new ConfigError(describe(filePath, field, 'value is not a string'))
  }
  return value
}

export function writeField(filePath: string, field: string, value: string): void {
  const kind = fileKind(filePath, field)
  const text = readText(filePath, field)
  const segments = parseField(field)
  if (kind === 'json') {
    const data = parseJson(filePath, field, text)
    if (getIn(data, segments) === undefined || !setIn(data, segments, value)) {
      throw new ConfigError(describe(filePath, field, 'field not found'))
    }
    writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n')
    return
  }
  const doc = parseYaml(filePath, field, text)
  // doc.setIn throws a raw (non-ConfigError) yaml-library Error for any path
  // it can't navigate — through an existing scalar, off the end of a
  // sequence, or when the document root isn't a collection — and silently
  // creates missing intermediate maps rather than failing. Checking
  // existence via getIn first (which never throws; it returns undefined for
  // all of the same cases) lets us raise ConfigError uniformly instead and
  // guarantees setIn always lands on a path that already exists.
  if (doc.getIn(segments) === undefined) {
    throw new ConfigError(describe(filePath, field, 'field not found'))
  }
  doc.setIn(segments, value)
  writeFileSync(filePath, doc.toString())
}
