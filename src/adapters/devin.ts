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
    const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
    const warnings: string[] = []
    const files: GeneratedFile[] = [{ path: '.devin-plugin/plugin.json', content: json(pluginManifest(model)) }]

    if (model.hooks !== undefined) warnings.push('hooks are not emitted for devin')
    if (model.commands.length) warnings.push('commands are not emitted for devin')
    if (model.agents.length) warnings.push('agents are not emitted for devin')
    if (model.mcp !== undefined) warnings.push('mcp servers are not emitted for devin')

    return { files, warnings }
  },
}
