import { deepMerge } from '../fileset.js'
import type { GeneratedFile } from '../fileset.js'
import type { PluginModel } from '../model.js'
import type { HarnessAdapter, EmitResult } from './types.js'

function pluginManifest(model: PluginModel): Record<string, unknown> {
  const { config } = model
  const manifest: Record<string, unknown> = {
    name: config.name,
    version: config.version,
    description: config.description,
  }
  if (config.author) manifest.author = config.author
  if (config.homepage) manifest.homepage = config.homepage
  if (config.repository) manifest.repository = config.repository
  if (config.license) manifest.license = config.license
  if (config.keywords) manifest.keywords = config.keywords
  manifest.skills = `./${config.components.skills}/`
  // Codex's loader auto-registers hooks/hooks.json unless the manifest holds
  // a literal empty object here — this avoids duplicate trust prompts.
  manifest.hooks = {}
  const override = config.harnesses.overrides.codex
  return override ? (deepMerge(manifest, override) as Record<string, unknown>) : manifest
}

export const codex: HarnessAdapter = {
  name: 'codex',
  support: {
    skills: 'full',
    commands: 'none',
    agents: 'none',
    hooks: 'none',
    mcp: 'none',
    bootstrap: 'partial',
  },
  emit(model: PluginModel): EmitResult {
    const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
    const warnings: string[] = []
    const files: GeneratedFile[] = [{ path: '.codex-plugin/plugin.json', content: json(pluginManifest(model)) }]

    if (model.hooks !== undefined) {
      warnings.push('hooks are not supported on codex; bootstrap relies on native skill discovery')
    }
    if (model.commands.length) warnings.push('commands are not emitted for codex in v1 (custom prompts land in Plan 3)')
    if (model.agents.length) warnings.push('agents are not emitted for codex in v1')
    if (model.mcp !== undefined) warnings.push('mcp servers are not emitted for codex in v1')

    return { files, warnings }
  },
}
