import type { EveryharnessConfig } from '../config.js'

// The name/version/description/author/homepage/repository/license/keywords
// subset that every adapter's root manifest starts from — present-only (a
// key appears only when set in everyharness.yaml). Field order here is
// name, version, description, author, homepage, repository, license,
// keywords; claude-code and cursor reconstruct a different on-disk order
// from the returned object to keep their existing generated output
// byte-identical (see the comments at their call sites).
export function baseManifestFields(config: EveryharnessConfig): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    name: config.name,
    version: config.version,
    description: config.description,
  }
  if (config.author) fields.author = config.author
  if (config.homepage) fields.homepage = config.homepage
  if (config.repository) fields.repository = config.repository
  if (config.license) fields.license = config.license
  if (config.keywords) fields.keywords = config.keywords
  return fields
}

export function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

// Whether a harness's shell-hook tier (session-start / run-hook.cmd / merged
// hooks.json, and the manifest's `hooks` pointer at that merged file) should
// be emitted for an active bootstrap. False when bootstrap is inactive
// ('none'), or when the plugin author set `harnesses.<name>.hooks: own` to keep
// their own hand-written hooks wiring instead. A harness with no settings entry
// defaults to 'generated'. Shared by claude-code and cursor, the only two
// adapters with a shell-hook tier (see HOOK_EMITTING_HARNESSES in config.ts) —
// each passes its own adapter name.
export function bootstrapEmitsHooks(config: EveryharnessConfig, harness: string): boolean {
  return config.bootstrap.kind !== 'none' && (config.harnesses.settings[harness]?.hooks ?? 'generated') === 'generated'
}

// The marketplace listing name an install id addresses the plugin by:
// `config.marketplace.name` when set, otherwise the local-dev default
// `<name>-dev`. Shared so every place that must agree on this name stays in
// lockstep: the claude-code adapter writes it into
// `.claude-plugin/marketplace.json` and its install doc, and the
// agents-marketplace adapter's copilot install line reuses it — because
// Copilot resolves plugins through that same `.claude-plugin/marketplace.json`
// (see agents-marketplace.ts), so a copilot install id keyed on anything else
// would not resolve.
export function marketplaceName(config: EveryharnessConfig): string {
  return config.marketplace?.name ?? `${config.name}-dev`
}

const GITHUB_REPO_URL = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/

// Extracts "owner/repo" from config.repository when it's a github.com URL —
// used by installDoc bodies to build a concrete install command instead of
// falling back to a placeholder. Any other form (a different host, ssh
// syntax, or no repository at all) returns undefined; callers substitute
// their own placeholder rather than guess.
export function githubOwnerRepo(repository: string | undefined): string | undefined {
  if (!repository) return undefined
  const match = GITHUB_REPO_URL.exec(repository.trim())
  return match ? `${match[1]}/${match[2]}` : undefined
}
