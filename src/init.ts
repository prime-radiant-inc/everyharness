import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, resolve, join } from 'node:path'
import { stringify } from 'yaml'
import { generate } from './generate.js'
import { ConfigError } from './config.js'

export interface InitResult {
  created: string[]
  generated: number
}

function sanitizePluginName(dirname: string): string {
  // Replace non-[a-z0-9-] characters with '-'
  let sanitized = dirname.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  // Collapse consecutive hyphens
  sanitized = sanitized.replace(/-+/g, '-')

  // Strip leading and trailing hyphens
  sanitized = sanitized.replace(/^-+|-+$/g, '')

  // If empty, fallback to 'my-plugin'
  if (!sanitized) {
    return 'my-plugin'
  }

  return sanitized
}

export function init(root: string, opts: { force?: boolean } = {}): InitResult {
  const rootAbs = resolve(root)

  // Ensure root directory exists
  mkdirSync(rootAbs, { recursive: true })

  const configPath = join(rootAbs, 'everyharness.yaml')

  // Check if config already exists
  if (existsSync(configPath) && !opts.force) {
    throw new ConfigError('everyharness.yaml already exists; use --force to re-scaffold the config (user files are never deleted)')
  }

  // Generate plugin name from directory basename
  const dirName = basename(rootAbs)
  const pluginName = sanitizePluginName(dirName)

  // Write everyharness.yaml
  const config = {
    name: pluginName,
    version: '0.1.0',
    description: 'TODO describe this plugin',
    // v2 tagged bootstrap: the 'generate' string literal. (The richer init
    // scaffold redesign is Task 2; this is the minimal v2 emission needed so
    // the scaffold loads under the v2 schema.)
    bootstrap: 'generate',
  }

  const created: string[] = []
  const yamlContent = stringify(config)
  writeFileSync(configPath, yamlContent)
  created.push('everyharness.yaml')

  // Create getting-started skill if it doesn't exist
  const skillDir = join(rootAbs, 'skills', 'getting-started')
  const skillPath = join(skillDir, 'SKILL.md')
  if (!existsSync(skillPath)) {
    mkdirSync(skillDir, { recursive: true })
    const skillContent = `---
name: getting-started
description: Use when getting started with this plugin - explains what it provides
---

# Getting Started

Describe your plugin's first skill here.
`
    writeFileSync(skillPath, skillContent)
    created.push('skills/getting-started/SKILL.md')
  }

  // Run generate
  try {
    const generateResult = generate(rootAbs)

    return {
      created,
      generated: generateResult.files.length,
    }
  } catch (err) {
    const originalMessage = err instanceof Error ? err.message : String(err)
    const scaffoldedList = created.join(' and ')
    throw new ConfigError(
      `init scaffolded ${scaffoldedList} but generate failed: ${originalMessage}`,
      [],
      { cause: err },
    )
  }
}
