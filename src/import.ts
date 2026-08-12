import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { stringify } from 'yaml'
import { ConfigError, PLUGIN_NAME_RE, loadConfig } from './config.js'

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
// carried into harnesses.claude-code.manifest verbatim.
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// plugin.json's `hooks`/`mcpServers` keys accept either a path string (found
// by the normal file-detection below) or an inline value — Claude embeds the
// hooks-file's/`.mcp.json`'s own top-level payload directly rather than
// wrapping it (see schemas/claude-code-plugin-manifest.json: the object arm
// of "hooks" is the event-name-keyed map, the same shape hooks.json wraps in
// {"hooks": ...}; the object arm of "mcpServers" is the server map, the same
// shape .mcp.json wraps in {"mcpServers": ...}). Silently dropping that value
// loses real configuration, so extract it to the default component file
// (2-space JSON + trailing newline) unless one is already there, in which
// case we refuse to clobber it and leave resolution to the user.
function extractInlineComponent(
  rootAbs: string,
  defaultPath: string,
  jsonKey: string,
  foundLabel: string,
  wrapKey: string,
  inlineValue: unknown,
  found: string[],
  warnings: string[],
  createdPaths: string[],
): boolean {
  const abs = join(rootAbs, defaultPath)
  if (existsSync(abs)) {
    warnings.push(`plugin.json's ${jsonKey} is defined inline but ${defaultPath} already exists; resolve manually`)
    return false
  }
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, `${JSON.stringify({ [wrapKey]: inlineValue }, null, 2)}\n`)
  createdPaths.push(abs)
  found.push(`${foundLabel} (inlined to ${defaultPath})`)
  warnings.push(`plugin.json's ${jsonKey} was defined inline; extracted to ${defaultPath}`)
  return true
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
  if (pluginJson.author !== undefined) {
    if (isPlainObject(pluginJson.author)) {
      output.author = pluginJson.author
    } else {
      warnings.push("plugin.json's author has an unexpected type; skipped")
    }
  }
  if (typeof pluginJson.license === 'string') output.license = pluginJson.license
  if (typeof pluginJson.repository === 'string') output.repository = pluginJson.repository
  if (typeof pluginJson.homepage === 'string') output.homepage = pluginJson.homepage
  if (pluginJson.keywords !== undefined) {
    if (Array.isArray(pluginJson.keywords)) {
      output.keywords = pluginJson.keywords
    } else {
      warnings.push("plugin.json's keywords has an unexpected type; skipped")
    }
  }

  // Component detection: resolve each component's path (custom plugin.json
  // key, else the everyharness default), then see what's actually on disk
  // at that path. found[] records what was detected; components only
  // records paths that both were detected AND differ from the default (no
  // point cluttering the yaml with a value loadConfig would infer anyway).
  const found: string[] = []
  const components: Record<string, string> = {}
  // Files extractInlineComponent creates this run — unlinked alongside
  // everyharness.yaml if loadConfig rejects the result below, so a bad
  // custom component path doesn't leave an orphaned .mcp.json/hooks.json
  // behind from an otherwise-failed import.
  const createdPaths: string[] = []

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

  const hooksRaw = pluginJson.hooks
  const hooksInline = hooksRaw !== undefined && typeof hooksRaw !== 'string' ? hooksRaw : undefined
  const hooksExtracted =
    hooksInline !== undefined &&
    extractInlineComponent(
      rootAbs,
      DEFAULT_PATHS.hooks,
      'hooks',
      'hooks',
      'hooks',
      hooksInline,
      found,
      warnings,
      createdPaths,
    )
  if (!hooksExtracted) {
    const hooksPath = resolveComponentPath(pluginJson, 'hooks', DEFAULT_PATHS.hooks)
    if (fileExists(rootAbs, hooksPath)) {
      found.push('hooks')
      if (hooksPath !== DEFAULT_PATHS.hooks) components.hooks = hooksPath
    }
  }

  const mcpRaw = pluginJson.mcpServers
  const mcpInline = mcpRaw !== undefined && typeof mcpRaw !== 'string' ? mcpRaw : undefined
  const mcpExtracted =
    mcpInline !== undefined &&
    extractInlineComponent(
      rootAbs,
      DEFAULT_PATHS.mcp,
      'mcpServers',
      'mcp',
      'mcpServers',
      mcpInline,
      found,
      warnings,
      createdPaths,
    )
  if (!mcpExtracted) {
    const mcpPath = resolveComponentPath(pluginJson, 'mcpServers', DEFAULT_PATHS.mcp)
    if (fileExists(rootAbs, mcpPath)) {
      found.push('mcp')
      if (mcpPath !== DEFAULT_PATHS.mcp) components.mcp = mcpPath
    }
  }

  // Bootstrap: a skill literally named using-<plugin-name> opts into the
  // skill-bootstrap mode; otherwise fall back to generate mode.
  const bootstrapSkillName = `using-${name}`
  // v2 tagged bootstrap: the { skill } object form, or the 'generate' string
  // literal. (Full import emission redesign — warning text, extras placement —
  // is Task 2; this is the minimal v2 emission so the written yaml round-trips
  // through the v2 loadConfig below.)
  output.bootstrap = skillDirs.includes(bootstrapSkillName) ? { skill: bootstrapSkillName } : 'generate'

  if (Object.keys(components).length > 0) output.components = components

  // Unknown top-level plugin.json keys carry through verbatim rather than
  // being silently dropped, so a claude-code-specific manifest extra
  // survives the conversion (as an explicit override the user can review).
  const overrideExtras: Record<string, unknown> = {}
  for (const key of Object.keys(pluginJson)) {
    if (MAPPED_PLUGIN_JSON_KEYS.has(key)) continue
    overrideExtras[key] = pluginJson[key]
    warnings.push(`carried unknown plugin.json key "${key}" into harnesses.claude-code.manifest`)
  }
  if (Object.keys(overrideExtras).length > 0) {
    // Carried extras become a manifest patch under harnesses.claude-code.
    output.harnesses = { 'claude-code': { manifest: overrideExtras } }
  }

  writeFileSync(configPath, stringify(output))

  // Round-trip the freshly written yaml through the same schema `generate`
  // and `validate` will use. This is the one place that catches every
  // schema violation an untrusted plugin.json could produce (an absolute or
  // traversal-y custom component path, an unexpected field shape, ...) in a
  // single net, rather than re-deriving each individual rule here.
  try {
    loadConfig(rootAbs)
  } catch (e) {
    unlinkSync(configPath)
    for (const path of createdPaths) unlinkSync(path)
    throw new ConfigError(
      `import produced an invalid everyharness.yaml (${(e as Error).message}); fix .claude-plugin/plugin.json and re-run`,
      [],
      { cause: e },
    )
  }

  return { configPath, found, warnings }
}
