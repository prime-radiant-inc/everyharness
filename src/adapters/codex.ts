import { deepMerge } from '../fileset.js'
import type { GeneratedFile } from '../fileset.js'
import type { PluginModel } from '../model.js'
import type { HarnessAdapter, EmitResult } from './types.js'
import { baseManifestFields, json } from './shared.js'

function pluginManifest(model: PluginModel): Record<string, unknown> {
  const { config } = model
  const manifest: Record<string, unknown> = { ...baseManifestFields(config) }
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
    const warnings: string[] = []
    const files: GeneratedFile[] = [{ path: '.codex-plugin/plugin.json', content: json(pluginManifest(model)) }]

    if (model.hooks !== undefined) {
      warnings.push('hooks are not supported on codex; bootstrap relies on native skill discovery')
    }
    if (model.commands.length) warnings.push('commands are not supported on codex (no plugin-shipped prompt mechanism)')
    if (model.agents.length) warnings.push('agents are not emitted for codex in v1')
    if (model.mcp !== undefined) warnings.push('mcp servers are not emitted for codex in v1')

    return { files, warnings }
  },
}
