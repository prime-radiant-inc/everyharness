import { deepMerge } from '../fileset.js'
import type { GeneratedFile } from '../fileset.js'
import type { PluginModel } from '../model.js'
import type { HarnessAdapter, EmitResult } from './types.js'
import { baseManifestFields, json } from './shared.js'

function pluginManifest(model: PluginModel): Record<string, unknown> {
  const { config } = model
  const manifest: Record<string, unknown> = { ...baseManifestFields(config) }
  manifest.skills = `./${config.components.skills}/`
  if (config.bootstrap.kind === 'skill') {
    manifest.sessionStart = { skill: config.bootstrap.skill }
  }
  const override = config.harnesses.overrides.kimi
  return override ? (deepMerge(manifest, override) as Record<string, unknown>) : manifest
}

export const kimi: HarnessAdapter = {
  name: 'kimi',
  support: {
    skills: 'full',
    commands: 'none',
    agents: 'none',
    hooks: 'none',
    mcp: 'none',
    bootstrap: 'full',
  },
  emit(model: PluginModel): EmitResult {
    const { config } = model
    const warnings: string[] = []
    const files: GeneratedFile[] = [{ path: '.kimi-plugin/plugin.json', content: json(pluginManifest(model)) }]

    if (config.bootstrap.kind === 'generate') {
      warnings.push('kimi sessionStart requires a named bootstrap skill; generate mode is not supported on kimi')
    }

    if (model.hooks !== undefined) warnings.push('hooks are not emitted for kimi')
    if (model.commands.length) warnings.push('commands are not emitted for kimi')
    if (model.agents.length) warnings.push('agents are not emitted for kimi')
    if (model.mcp !== undefined) warnings.push('mcp servers are not emitted for kimi')

    return { files, warnings }
  },
}
