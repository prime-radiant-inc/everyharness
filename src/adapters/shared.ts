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
