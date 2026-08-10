import { deepMerge } from '../fileset.js'
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
  if (config.license) manifest.license = config.license
  if (config.repository) manifest.repository = config.repository
  if (config.homepage) manifest.homepage = config.homepage
  if (config.keywords) manifest.keywords = config.keywords
  // Claude Code auto-discovers commands/, agents/, skills/, hooks/hooks.json,
  // and .mcp.json; only non-default locations need explicit manifest keys.
  if (model.skills.length && config.components.skills !== 'skills') {
    manifest.skills = `./${config.components.skills}`
  }
  if (model.commands.length && config.components.commands !== 'commands') {
    manifest.commands = `./${config.components.commands}`
  }
  if (model.agents.length && config.components.agents !== 'agents') {
    manifest.agents = `./${config.components.agents}`
  }
  if (model.hooks !== undefined && config.components.hooks !== 'hooks/hooks.json') {
    manifest.hooks = `./${config.components.hooks}`
  }
  if (model.mcp !== undefined && config.components.mcp !== '.mcp.json') {
    manifest.mcpServers = `./${config.components.mcp}`
  }
  const override = config.harnesses.overrides['claude-code']
  return override ? (deepMerge(manifest, override) as Record<string, unknown>) : manifest
}

function marketplaceManifest(model: PluginModel): Record<string, unknown> {
  const { config } = model
  const entry: Record<string, unknown> = {
    name: config.name,
    description: config.description,
    version: config.version,
    source: './',
  }
  if (config.author) entry.author = config.author
  if (config.marketplace?.category) entry.category = config.marketplace.category
  if (config.marketplace?.tags) entry.keywords = config.marketplace.tags
  const marketplace: Record<string, unknown> = {
    name: `${config.name}-dev`,
    description: `Development marketplace for ${config.name}`,
    plugins: [entry],
  }
  if (config.author) marketplace.owner = config.author
  return marketplace
}

export const claudeCode: HarnessAdapter = {
  name: 'claude-code',
  support: {
    skills: 'full',
    commands: 'full',
    agents: 'full',
    hooks: 'full',
    mcp: 'full',
    bootstrap: 'full',
  },
  emit(model: PluginModel): EmitResult {
    const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
    return {
      files: [
        { path: '.claude-plugin/plugin.json', content: json(pluginManifest(model)) },
        { path: '.claude-plugin/marketplace.json', content: json(marketplaceManifest(model)) },
      ],
      warnings: [],
    }
  },
}
