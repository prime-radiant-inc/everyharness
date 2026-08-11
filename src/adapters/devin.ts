import { deepMerge } from '../fileset.js'
import type { GeneratedFile } from '../fileset.js'
import type { PluginModel } from '../model.js'
import type { HarnessAdapter, EmitResult } from './types.js'
import { baseManifestFields, json } from './shared.js'

function pluginManifest(model: PluginModel): Record<string, unknown> {
  const { config } = model
  const manifest = baseManifestFields(config)
  const override = config.harnesses.overrides.devin
  return override ? (deepMerge(manifest, override) as Record<string, unknown>) : manifest
}

export const devin: HarnessAdapter = {
  name: 'devin',
  support: {
    skills: 'full',
    commands: 'none',
    agents: 'none',
    hooks: 'none',
    mcp: 'none',
    bootstrap: 'none',
  },
  emit(model: PluginModel): EmitResult {
    const warnings: string[] = []
    const files: GeneratedFile[] = [{ path: '.devin-plugin/plugin.json', content: json(pluginManifest(model)) }]

    if (model.hooks !== undefined) warnings.push('hooks are not emitted for devin')
    if (model.commands.length) warnings.push('commands are not emitted for devin')
    if (model.agents.length) warnings.push('agents are not emitted for devin')
    if (model.mcp !== undefined) warnings.push('mcp servers are not emitted for devin')

    return { files, warnings }
  },
}
