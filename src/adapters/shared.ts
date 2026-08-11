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
