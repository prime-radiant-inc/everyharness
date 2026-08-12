import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'

export class ConfigError extends Error {
  details: string[]
  constructor(message: string, details: string[] = [], opts: { cause?: unknown } = {}) {
    super(details.length ? `${message}\n  - ${details.join('\n  - ')}` : message, { cause: opts.cause })
    this.name = 'ConfigError'
    this.details = details
  }
}

export type BootstrapMode =
  | { kind: 'skill'; skill: string; emitHooks: boolean }
  | { kind: 'generate'; emitHooks: boolean }
  | { kind: 'none' }

// Shared with import.ts, which validates a Claude plugin.json's name against
// this same rule before writing it into everyharness.yaml.
export const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9-]*$/

// The anchored semver rule for the plugin `version` field. Exported so the
// bump command validates a requested new version against the exact same rule
// (and reuses the same human-facing wording) the schema enforces on load.
export const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
export const VERSION_MESSAGE = 'semver, e.g. 1.2.3'

const authorSchema = z.object({
  name: z.string(),
  email: z.string().optional(),
  url: z.string().optional(),
})

// Component paths: [A-Za-z0-9._-]+ segments joined by /, normalized to strip
// trailing slashes before validation. Regex rejects quotes, backslashes, spaces,
// shell metacharacters — ensuring safe substitution into emitted Python/JS/TS.
// The charset alone permits a `.` or `..` segment (both are valid runs of
// dots), which would let a path escape the plugin root -- rejected separately
// below rather than folded into the charset regex.
const requiredComponentPath = z.preprocess(
  (val) => (typeof val === 'string' ? val.replace(/\/+$/, '') : val),
  z
    .string()
    .regex(
      /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/,
      'path segments may contain only letters, digits, dot, underscore, hyphen',
    )
    .refine((s) => !s.split('/').includes('.') && !s.split('/').includes('..'), {
      message: 'path segments may not be . or ..',
    }),
)
const componentPath = requiredComponentPath.optional()

const rawSchema = z.object({
  name: z.string().regex(PLUGIN_NAME_RE, 'lowercase alphanumerics and hyphens'),
  version: z.string().regex(VERSION_RE, VERSION_MESSAGE),
  description: z.string(),
  author: authorSchema.optional(),
  license: z.string().optional(),
  repository: z.string().optional(),
  homepage: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  bootstrap: z
    .object({
      skill: z.string().optional(),
      generate: z.literal(true).optional(),
      none: z.literal(true).optional(),
      emitHooks: z.boolean().optional(),
    })
    .optional(),
  components: z
    .object({
      skills: componentPath,
      commands: componentPath,
      agents: componentPath,
      hooks: componentPath,
      mcp: componentPath,
    })
    .optional(),
  harnesses: z
    .object({
      exclude: z.array(z.string()).optional(),
      overrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    })
    .optional(),
  marketplace: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      source: z
        .union([
          z.literal('local'),
          z.literal('repository'),
          z.string().regex(/^https?:\/\//, 'must be "local", "repository", or an http(s) URL'),
        ])
        .optional(),
      category: z.string().optional(),
      tags: z.array(z.string()).optional(),
      strict: z.boolean().optional(),
    })
    .optional(),
  bump: z
    .object({
      files: z
        .array(
          z.object({
            path: requiredComponentPath,
            field: z.string(),
          }),
        )
        .optional(),
      audit: z
        .object({
          exclude: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
})

export interface EveryharnessConfig {
  name: string
  version: string
  description: string
  author?: z.infer<typeof authorSchema>
  license?: string
  repository?: string
  homepage?: string
  keywords?: string[]
  bootstrap: BootstrapMode
  components: { skills: string; commands: string; agents: string; hooks: string; mcp: string }
  harnesses: { exclude: string[]; overrides: Record<string, Record<string, unknown>> }
  marketplace?: {
    name?: string
    description?: string
    source?: 'local' | 'repository' | string
    category?: string
    tags?: string[]
    strict?: boolean
  }
  bump?: {
    files?: { path: string; field: string }[]
    audit?: { exclude?: string[] }
  }
}

function resolveBootstrap(raw: z.infer<typeof rawSchema>['bootstrap']): BootstrapMode {
  if (!raw) return { kind: 'none' }
  const modes = [raw.skill !== undefined, raw.generate === true, raw.none === true]
  const count = modes.filter(Boolean).length
  if (count !== 1) {
    throw new ConfigError(
      'bootstrap: set exactly one of skill / generate / none',
      [`bootstrap has ${count} modes set`],
    )
  }
  if (raw.none) {
    if (raw.emitHooks !== undefined) {
      throw new ConfigError('bootstrap.emitHooks: only valid with skill or generate, not none')
    }
    return { kind: 'none' }
  }
  const emitHooks = raw.emitHooks ?? true
  if (raw.skill !== undefined) return { kind: 'skill', skill: raw.skill, emitHooks }
  return { kind: 'generate', emitHooks }
}

function checkMarketplace(marketplace: z.infer<typeof rawSchema>['marketplace'], repository: string | undefined): void {
  if (marketplace?.source === 'repository' && !repository) {
    throw new ConfigError(
      'marketplace.source: repository requires a top-level repository field',
    )
  }
}

export function loadConfig(root: string): EveryharnessConfig {
  const path = join(root, 'everyharness.yaml')
  if (!existsSync(path)) {
    throw new ConfigError(`everyharness.yaml not found in ${root}`)
  }
  let doc: unknown
  try {
    doc = parse(readFileSync(path, 'utf8'))
  } catch (e) {
    throw new ConfigError(`everyharness.yaml is not valid YAML: ${(e as Error).message}`, [], { cause: e })
  }
  const parsed = rawSchema.safeParse(doc)
  if (!parsed.success) {
    throw new ConfigError(
      'everyharness.yaml is invalid',
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    )
  }
  const raw = parsed.data
  checkMarketplace(raw.marketplace, raw.repository)
  return {
    name: raw.name,
    version: raw.version,
    description: raw.description,
    author: raw.author,
    license: raw.license,
    repository: raw.repository,
    homepage: raw.homepage,
    keywords: raw.keywords,
    bootstrap: resolveBootstrap(raw.bootstrap),
    components: {
      skills: raw.components?.skills ?? 'skills',
      commands: raw.components?.commands ?? 'commands',
      agents: raw.components?.agents ?? 'agents',
      hooks: raw.components?.hooks ?? 'hooks/hooks.json',
      mcp: raw.components?.mcp ?? '.mcp.json',
    },
    harnesses: {
      exclude: raw.harnesses?.exclude ?? [],
      overrides: raw.harnesses?.overrides ?? {},
    },
    marketplace: raw.marketplace,
    bump: raw.bump,
  }
}
