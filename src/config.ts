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

// The harnesses whose adapters have a shell-hook tier and therefore honor
// `harnesses.<name>.hooks: own`. Shared by resolveBootstrap (validates that a
// `hooks: own` opt-out only names a hook-emitting harness) and
// bootstrapEmitsHooks's callers (each adapter passes its own name).
export const HOOK_EMITTING_HARNESSES = ['claude-code', 'cursor'] as const

// The canonical adapter-name registry, used to validate that every key under
// `harnesses:` (other than `exclude`) names a real adapter — so a typo like
// `claudecode:` is a ConfigError instead of a silently-ignored block.
// config.ts cannot import the live registry from src/adapters/index.ts without
// an import cycle (every adapter imports EveryharnessConfig from this file), so
// the list is duplicated here and kept honest by tests/adapters/registry.test.ts,
// which asserts it matches `adapters.map(a => a.name)`.
export const ADAPTER_NAMES = [
  'claude-code',
  'cursor',
  'codex',
  'devin',
  'kimi',
  'gemini',
  'opencode',
  'pi',
  'hermes',
  'agent-plugins-1.0',
  'agents-marketplace',
] as const

export type BootstrapMode =
  | { kind: 'skill'; skill: string }
  | { kind: 'generate' }
  | { kind: 'none' }

// A resolved harnesses.<name> block: the per-harness hook tier ('generated'
// default | 'own') and an optional manifest patch (deep-merged into the
// adapter's generated manifest; a null value is the delete-sentinel).
export interface HarnessSettings {
  hooks: 'generated' | 'own'
  manifest?: Record<string, unknown>
}

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

// bootstrap is a tagged value: the string literals 'none'/'generate', or the
// object form { skill: <name> } when the skill-bootstrap needs a parameter.
// Legacy object forms ({ none: true } / { generate: true } / emitHooks) are
// rejected with pointed migration errors in rejectLegacySyntax before the
// schema ever runs.
const bootstrapSchema = z
  .union([z.literal('none'), z.literal('generate'), z.object({ skill: z.string() })])
  .optional()

const releaseSchema = z
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
  .optional()

const rawSchema = z.object({
  name: z.string().regex(PLUGIN_NAME_RE, 'lowercase alphanumerics and hyphens'),
  version: z.string().regex(VERSION_RE, VERSION_MESSAGE),
  description: z.string(),
  author: authorSchema.optional(),
  license: z.string().optional(),
  repository: z.string().optional(),
  homepage: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  bootstrap: bootstrapSchema,
  components: z
    .object({
      skills: componentPath,
      commands: componentPath,
      agents: componentPath,
      hooks: componentPath,
      mcp: componentPath,
    })
    .optional(),
  // exclude is validated here; the per-harness settings blocks (any adapter
  // name) pass through and are validated by resolveHarnessSettings so their
  // keys can be checked against the adapter registry and given pointed errors.
  harnesses: z
    .object({
      exclude: z.array(z.string()).optional(),
    })
    .passthrough()
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
  release: releaseSchema,
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
  harnesses: { exclude: string[]; settings: Record<string, HarnessSettings> }
  marketplace?: {
    name?: string
    description?: string
    source?: 'local' | 'repository' | string
    category?: string
    tags?: string[]
    strict?: boolean
  }
  release?: {
    files?: { path: string; field: string }[]
    audit?: { exclude?: string[] }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// The four config-v1 syntaxes are a clean break in v2 (Jesse's call: only his
// own plugins use everyharness, so no back-compat). Each is caught on the raw
// document BEFORE the schema parse so the author gets a pointed migration
// message naming the replacement, not a generic zod validation error.
function rejectLegacySyntax(doc: unknown): void {
  if (!isPlainObject(doc)) return
  const bootstrap = doc.bootstrap
  if (isPlainObject(bootstrap)) {
    if ('none' in bootstrap || 'generate' in bootstrap) {
      throw new ConfigError(
        'bootstrap is now a tagged value: use "bootstrap: none", "bootstrap: generate", or "bootstrap: { skill: <name> }"',
      )
    }
    if ('emitHooks' in bootstrap) {
      throw new ConfigError('bootstrap.emitHooks moved: set harnesses.<name>.hooks: own')
    }
  }
  const harnesses = doc.harnesses
  if (isPlainObject(harnesses) && 'overrides' in harnesses) {
    throw new ConfigError('harnesses.overrides moved: put manifest patches under harnesses.<name>.manifest')
  }
  if ('bump' in doc) {
    throw new ConfigError('bump: was renamed: use release: (same fields)')
  }
}

// Validates every harnesses.<name> block from the v2 dialect: unknown harness
// names (typo-catching against ADAPTER_NAMES), the hooks enum, that manifest is
// a mapping, and that no stray keys sneak in. Returns the resolved per-harness
// settings that consumers read directly (hooks defaults to 'generated').
function resolveHarnessSettings(raw: Record<string, unknown> | undefined): {
  exclude: string[]
  settings: Record<string, HarnessSettings>
} {
  const exclude = (raw?.exclude as string[] | undefined) ?? []
  const settings: Record<string, HarnessSettings> = {}
  if (!raw) return { exclude, settings }

  for (const [key, value] of Object.entries(raw)) {
    if (key === 'exclude') continue
    if (!(ADAPTER_NAMES as readonly string[]).includes(key)) {
      throw new ConfigError(`harnesses.${key}: unknown harness name`, [`valid names: ${ADAPTER_NAMES.join(', ')}`])
    }
    if (!isPlainObject(value)) {
      throw new ConfigError(`harnesses.${key}: must be a mapping of hooks and/or manifest`)
    }
    for (const settingKey of Object.keys(value)) {
      if (settingKey !== 'hooks' && settingKey !== 'manifest') {
        throw new ConfigError(`harnesses.${key}.${settingKey}: unknown key (expected hooks or manifest)`)
      }
    }
    const entry: HarnessSettings = { hooks: 'generated' }
    if ('hooks' in value) {
      const hooks = value.hooks
      if (hooks !== 'generated' && hooks !== 'own') {
        throw new ConfigError(`harnesses.${key}.hooks: must be "generated" or "own"`)
      }
      entry.hooks = hooks
    }
    if ('manifest' in value) {
      const manifest = value.manifest
      if (!isPlainObject(manifest)) {
        throw new ConfigError(`harnesses.${key}.manifest: must be a mapping`)
      }
      entry.manifest = manifest
    }
    settings[key] = entry
  }
  return { exclude, settings }
}

// Resolves the tagged bootstrap value into its internal model: the string
// literals map to 'none'/'generate', the { skill } object to the skill mode,
// and an absent value to 'none'.
function resolveBootstrap(raw: z.infer<typeof rawSchema>['bootstrap']): BootstrapMode {
  if (raw === undefined || raw === 'none') return { kind: 'none' }
  if (raw === 'generate') return { kind: 'generate' }
  return { kind: 'skill', skill: raw.skill }
}

// A `hooks: own` opt-out is only meaningful on a hook-emitting harness with an
// active bootstrap; anywhere else there are no generated hooks to suppress, so
// it's a pointed ConfigError rather than a silent no-op.
function validateHarnessHooks(settings: Record<string, HarnessSettings>, bootstrap: BootstrapMode): void {
  for (const [name, entry] of Object.entries(settings)) {
    if (entry.hooks !== 'own') continue
    if (!(HOOK_EMITTING_HARNESSES as readonly string[]).includes(name)) {
      throw new ConfigError(
        `harnesses.${name}.hooks: own is only valid on hook-emitting harnesses (${HOOK_EMITTING_HARNESSES.join(', ')})`,
      )
    }
    if (bootstrap.kind === 'none') {
      throw new ConfigError(
        `harnesses.${name}.hooks: own requires an active bootstrap (bootstrap: generate or bootstrap: { skill: <name> }); there are no generated hooks to suppress`,
      )
    }
  }
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
  rejectLegacySyntax(doc)
  const parsed = rawSchema.safeParse(doc)
  if (!parsed.success) {
    throw new ConfigError(
      'everyharness.yaml is invalid',
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    )
  }
  const raw = parsed.data
  checkMarketplace(raw.marketplace, raw.repository)

  const { exclude, settings } = resolveHarnessSettings(raw.harnesses)
  const bootstrap = resolveBootstrap(raw.bootstrap)
  validateHarnessHooks(settings, bootstrap)

  return {
    name: raw.name,
    version: raw.version,
    description: raw.description,
    author: raw.author,
    license: raw.license,
    repository: raw.repository,
    homepage: raw.homepage,
    keywords: raw.keywords,
    bootstrap,
    components: {
      skills: raw.components?.skills ?? 'skills',
      commands: raw.components?.commands ?? 'commands',
      agents: raw.components?.agents ?? 'agents',
      hooks: raw.components?.hooks ?? 'hooks/hooks.json',
      mcp: raw.components?.mcp ?? '.mcp.json',
    },
    harnesses: { exclude, settings },
    marketplace: raw.marketplace,
    release: raw.release,
  }
}
