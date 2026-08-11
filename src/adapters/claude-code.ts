import { deepMerge } from '../fileset.js'
import type { GeneratedFile } from '../fileset.js'
import type { PluginModel } from '../model.js'
import type { HarnessAdapter, EmitResult } from './types.js'
import { sessionStartScript, runHookCmd, mergedClaudeHooks } from '../bootstrap/shell-hook.js'
import { generatedBootstrap, GENERATED_BOOTSTRAP_PATH } from '../bootstrap/generated.js'
import { baseManifestFields, json } from './shared.js'

// Where the claude-code adapter emits the bootstrap SessionStart hook and its
// merged hooks.json, when config.bootstrap.kind === 'skill'.
const BOOTSTRAP_HOOKS_DIR = 'hooks/everyharness'
const BOOTSTRAP_HOOKS_JSON_PATH = `${BOOTSTRAP_HOOKS_DIR}/hooks.json`

function pluginManifest(model: PluginModel): Record<string, unknown> {
  const { config } = model
  const base = baseManifestFields(config)
  // baseManifestFields orders homepage/repository/license the other way
  // (shared with cursor/codex/devin/kimi); reconstruct claude-code's own
  // on-disk order (license, repository, homepage) to keep generated output
  // byte-identical.
  const manifest: Record<string, unknown> = { name: base.name, version: base.version, description: base.description }
  if ('author' in base) manifest.author = base.author
  if ('license' in base) manifest.license = base.license
  if ('repository' in base) manifest.repository = base.repository
  if ('homepage' in base) manifest.homepage = base.homepage
  if ('keywords' in base) manifest.keywords = base.keywords
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
  if (config.bootstrap.kind === 'skill' || config.bootstrap.kind === 'generate') {
    // Bootstrap hooks always live at a non-default path, and always exist
    // (even with no user hooks), so this takes priority over the general
    // non-default-path rule below.
    manifest.hooks = `./${BOOTSTRAP_HOOKS_JSON_PATH}`
  } else if (model.hooks !== undefined && config.components.hooks !== 'hooks/hooks.json') {
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
    const { config } = model
    const warnings: string[] = []
    const files: GeneratedFile[] = [
      { path: '.claude-plugin/plugin.json', content: json(pluginManifest(model)) },
      { path: '.claude-plugin/marketplace.json', content: json(marketplaceManifest(model)) },
    ]
    if (config.bootstrap.kind === 'skill') {
      const skillName = config.bootstrap.skill
      const skill = model.skills.find((s) => s.name === skillName)
      if (!skill) {
        // buildModel validates the bootstrap skill exists before adapters run.
        throw new Error(`bootstrap skill "${skillName}" not found (buildModel should have validated this)`)
      }
      files.push(
        {
          path: `${BOOTSTRAP_HOOKS_DIR}/session-start`,
          content: sessionStartScript({ pluginName: config.name, bootstrapContentPath: `${skill.dir}/SKILL.md` }),
          executable: true,
        },
        { path: `${BOOTSTRAP_HOOKS_DIR}/run-hook.cmd`, content: runHookCmd(), executable: true },
        { path: BOOTSTRAP_HOOKS_JSON_PATH, content: json(mergedClaudeHooks(model.hooks)) },
      )
    } else if (config.bootstrap.kind === 'generate') {
      files.push(
        { path: GENERATED_BOOTSTRAP_PATH, content: generatedBootstrap(model) },
        {
          path: `${BOOTSTRAP_HOOKS_DIR}/session-start`,
          content: sessionStartScript({ pluginName: config.name, bootstrapContentPath: GENERATED_BOOTSTRAP_PATH }),
          executable: true,
        },
        { path: `${BOOTSTRAP_HOOKS_DIR}/run-hook.cmd`, content: runHookCmd(), executable: true },
        { path: BOOTSTRAP_HOOKS_JSON_PATH, content: json(mergedClaudeHooks(model.hooks)) },
      )
    }
    return { files, warnings }
  },
}
