import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { stringify } from 'yaml'
import { ConfigError, PLUGIN_NAME_RE } from './config.js'

export interface ImportResult {
  configPath: string
  found: string[]
  warnings: string[]
}

// everyharness's own defaults (see config.ts's loadConfig) — a plugin.json
// path that resolves to one of these isn't a customization worth recording.
const DEFAULT_PATHS = {
  skills: 'skills',
  commands: 'commands',
  agents: 'agents',
  hooks: 'hooks/hooks.json',
  mcp: '.mcp.json',
} as const

// The plugin.json keys this importer understands: the eight mapped
// top-level fields plus the five component-path override keys (mcpServers
// is Claude's name for the mcp override). Anything else is unknown and
// carried into harnesses.overrides.claude-code verbatim.
const MAPPED_PLUGIN_JSON_KEYS = new Set([
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'skills',
  'commands',
  'agents',
  'hooks',
  'mcpServers',
])

function stripLeadingDotSlash(path: string): string {
  return path.startsWith('./') ? path.slice(2) : path
}

// A custom path key in plugin.json overrides the corresponding default
// entirely (v1 doesn't support Claude's array/"in addition to" forms —
// everyharness's own componentPath schema is a single string too).
function resolveComponentPath(pluginJson: Record<string, unknown>, key: string, defaultPath: string): string {
  const raw = pluginJson[key]
  return typeof raw === 'string' ? stripLeadingDotSlash(raw) : defaultPath
}

function listSkillDirs(root: string, dir: string): string[] {
  const abs = join(root, dir)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return []
  return readdirSync(abs)
    .filter((entry) => statSync(join(abs, entry)).isDirectory())
    .filter((entry) => existsSync(join(abs, entry, 'SKILL.md')))
}

function countMarkdownFiles(root: string, dir: string): number {
  const abs = join(root, dir)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return 0
  return readdirSync(abs).filter((f) => f.endsWith('.md')).length
}

function fileExists(root: string, path: string): boolean {
  const abs = join(root, path)
  return existsSync(abs) && statSync(abs).isFile()
}

export function importPlugin(root: string): ImportResult {
  const rootAbs = resolve(root)
  const configPath = join(rootAbs, 'everyharness.yaml')

  if (existsSync(configPath)) {
    throw new ConfigError('everyharness.yaml already exists; import is a one-time conversion')
  }

  const pluginJsonPath = join(rootAbs, '.claude-plugin', 'plugin.json')
  const NOT_CLAUDE_FORMAT = 'no .claude-plugin/plugin.json found; import currently supports Claude-format plugins only'
  if (!existsSync(pluginJsonPath)) {
    throw new ConfigError(NOT_CLAUDE_FORMAT)
  }
  let pluginJson: Record<string, unknown>
  try {
    pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf8')) as Record<string, unknown>
  } catch (e) {
    throw new ConfigError(NOT_CLAUDE_FORMAT, [], { cause: e })
  }

  const warnings: string[] = []

  const name = typeof pluginJson.name === 'string' ? pluginJson.name : ''
  if (!PLUGIN_NAME_RE.test(name)) {
    throw new ConfigError(
      `plugin.json name "${name}" is not a valid everyharness plugin name (lowercase alphanumerics and hyphens)`,
    )
  }

  let version: string
  if (typeof pluginJson.version === 'string' && pluginJson.version) {
    version = pluginJson.version
  } else {
    version = '0.1.0'
    warnings.push('plugin.json has no version; defaulting to 0.1.0')
  }

  let description: string
  if (typeof pluginJson.description === 'string' && pluginJson.description) {
    description = pluginJson.description
  } else {
    description = 'TODO describe this plugin'
    warnings.push('plugin.json has no description; defaulting to "TODO describe this plugin"')
  }

  const output: Record<string, unknown> = { name, version, description }
  if (pluginJson.author !== undefined) output.author = pluginJson.author
  if (typeof pluginJson.license === 'string') output.license = pluginJson.license
  if (typeof pluginJson.repository === 'string') output.repository = pluginJson.repository
  if (typeof pluginJson.homepage === 'string') output.homepage = pluginJson.homepage
  if (pluginJson.keywords !== undefined) output.keywords = pluginJson.keywords

  // Component detection: resolve each component's path (custom plugin.json
  // key, else the everyharness default), then see what's actually on disk
  // at that path. found[] records what was detected; components only
  // records paths that both were detected AND differ from the default (no
  // point cluttering the yaml with a value loadConfig would infer anyway).
  const found: string[] = []
  const components: Record<string, string> = {}

  const skillsPath = resolveComponentPath(pluginJson, 'skills', DEFAULT_PATHS.skills)
  const skillDirs = listSkillDirs(rootAbs, skillsPath)
  if (skillDirs.length > 0) {
    found.push(`skills (${skillDirs.length})`)
    if (skillsPath !== DEFAULT_PATHS.skills) components.skills = skillsPath
  }

  const commandsPath = resolveComponentPath(pluginJson, 'commands', DEFAULT_PATHS.commands)
  const commandsCount = countMarkdownFiles(rootAbs, commandsPath)
  if (commandsCount > 0) {
    found.push(`commands (${commandsCount})`)
    if (commandsPath !== DEFAULT_PATHS.commands) components.commands = commandsPath
  }

  const agentsPath = resolveComponentPath(pluginJson, 'agents', DEFAULT_PATHS.agents)
  const agentsCount = countMarkdownFiles(rootAbs, agentsPath)
  if (agentsCount > 0) {
    found.push(`agents (${agentsCount})`)
    if (agentsPath !== DEFAULT_PATHS.agents) components.agents = agentsPath
  }

  const hooksPath = resolveComponentPath(pluginJson, 'hooks', DEFAULT_PATHS.hooks)
  if (fileExists(rootAbs, hooksPath)) {
    found.push('hooks')
    if (hooksPath !== DEFAULT_PATHS.hooks) components.hooks = hooksPath
  }

  const mcpPath = resolveComponentPath(pluginJson, 'mcpServers', DEFAULT_PATHS.mcp)
  if (fileExists(rootAbs, mcpPath)) {
    found.push('mcp')
    if (mcpPath !== DEFAULT_PATHS.mcp) components.mcp = mcpPath
  }

  // Bootstrap: a skill literally named using-<plugin-name> opts into the
  // skill-bootstrap mode; otherwise fall back to generate mode.
  const bootstrapSkillName = `using-${name}`
  output.bootstrap = skillDirs.includes(bootstrapSkillName)
    ? { skill: bootstrapSkillName }
    : { generate: true }

  if (Object.keys(components).length > 0) output.components = components

  // Unknown top-level plugin.json keys carry through verbatim rather than
  // being silently dropped, so a claude-code-specific manifest extra
  // survives the conversion (as an explicit override the user can review).
  const overrideExtras: Record<string, unknown> = {}
  for (const key of Object.keys(pluginJson)) {
    if (MAPPED_PLUGIN_JSON_KEYS.has(key)) continue
    overrideExtras[key] = pluginJson[key]
    warnings.push(`carried unknown plugin.json key "${key}" into harnesses.overrides.claude-code`)
  }
  if (Object.keys(overrideExtras).length > 0) {
    output.harnesses = { overrides: { 'claude-code': overrideExtras } }
  }

  writeFileSync(configPath, stringify(output))

  return { configPath, found, warnings }
}
