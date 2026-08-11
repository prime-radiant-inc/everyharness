import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'

export class ConfigError extends Error {
  details: string[]
  constructor(message: string, details: string[] = []) {
    super(details.length ? `${message}\n  - ${details.join('\n  - ')}` : message)
    this.name = 'ConfigError'
    this.details = details
  }
}

export type BootstrapMode =
  | { kind: 'skill'; skill: string }
  | { kind: 'generate' }
  | { kind: 'none' }

const authorSchema = z.object({
  name: z.string(),
  email: z.string().optional(),
  url: z.string().optional(),
})

const rawSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase alphanumerics and hyphens'),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'semver, e.g. 1.2.3'),
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
    })
    .optional(),
  components: z
    .object({
      skills: z.string().optional(),
      commands: z.string().optional(),
      agents: z.string().optional(),
      hooks: z.string().optional(),
      mcp: z.string().optional(),
    })
    .optional(),
  harnesses: z
    .object({
      exclude: z.array(z.string()).optional(),
      overrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    })
    .optional(),
  marketplace: z
    .object({ category: z.string().optional(), tags: z.array(z.string()).optional() })
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
  marketplace?: { category?: string; tags?: string[] }
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
  if (raw.skill !== undefined) return { kind: 'skill', skill: raw.skill }
  if (raw.generate) return { kind: 'generate' }
  return { kind: 'none' }
}

function normalizeComponentPath(path: string): string {
  return path.replace(/\/+$/, '')
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
    throw new ConfigError(`everyharness.yaml is not valid YAML: ${(e as Error).message}`)
  }
  const parsed = rawSchema.safeParse(doc)
  if (!parsed.success) {
    throw new ConfigError(
      'everyharness.yaml is invalid',
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    )
  }
  const raw = parsed.data
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
      skills: normalizeComponentPath(raw.components?.skills ?? 'skills'),
      commands: normalizeComponentPath(raw.components?.commands ?? 'commands'),
      agents: normalizeComponentPath(raw.components?.agents ?? 'agents'),
      hooks: normalizeComponentPath(raw.components?.hooks ?? 'hooks/hooks.json'),
      mcp: normalizeComponentPath(raw.components?.mcp ?? 'mcp.json'),
    },
    harnesses: {
      exclude: raw.harnesses?.exclude ?? [],
      overrides: raw.harnesses?.overrides ?? {},
    },
    marketplace: raw.marketplace,
  }
}
