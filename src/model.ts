import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, ConfigError, type EveryharnessConfig } from './config.js'
import { parseFrontmatter } from './frontmatter.js'

export interface SkillRef {
  name: string
  dir: string
  description: string
}
export interface CommandRef {
  name: string
  path: string
  description?: string
}
export interface AgentRef {
  name: string
  path: string
  description?: string
}
export interface PluginModel {
  root: string
  config: EveryharnessConfig
  skills: SkillRef[]
  commands: CommandRef[]
  agents: AgentRef[]
  hooks?: unknown
  mcp?: unknown
}

function readSkills(root: string, skillsDir: string): SkillRef[] {
  const abs = join(root, skillsDir)
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .filter((entry) => statSync(join(abs, entry)).isDirectory())
    .filter((entry) => existsSync(join(abs, entry, 'SKILL.md')))
    .map((entry) => {
      const { data } = parseFrontmatter(readFileSync(join(abs, entry, 'SKILL.md'), 'utf8'))
      return {
        name: typeof data.name === 'string' ? data.name : entry,
        dir: `${skillsDir}/${entry}`,
        description: typeof data.description === 'string' ? data.description : '',
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function readMarkdownComponents(root: string, dir: string): Array<{
  name: string
  path: string
  data: Record<string, unknown>
}> {
  const abs = join(root, dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { data } = parseFrontmatter(readFileSync(join(abs, f), 'utf8'))
      return { name: f.replace(/\.md$/, ''), path: `${dir}/${f}`, data }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function readJsonIfPresent(root: string, rel: string): unknown {
  const abs = join(root, rel)
  if (!existsSync(abs)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8'))
  } catch (e) {
    throw new ConfigError(`${rel} is not valid JSON: ${(e as Error).message}`)
  }
  // Guards two downstream failure modes: `null` crashes mergedClaudeHooks, and an
  // array silently drops the bootstrap entry when JSON.stringify-d back out.
  if (!isPlainObject(parsed)) {
    throw new ConfigError(`${rel} must contain a JSON object`)
  }
  return parsed
}

export function buildModel(root: string): PluginModel {
  const config = loadConfig(root)
  const skills = readSkills(root, config.components.skills)
  const commands = readMarkdownComponents(root, config.components.commands).map((c) => ({
    name: c.name,
    path: c.path,
    description: typeof c.data.description === 'string' ? c.data.description : undefined,
  }))
  const agents = readMarkdownComponents(root, config.components.agents).map((a) => ({
    name: typeof a.data.name === 'string' ? a.data.name : a.name,
    path: a.path,
    description: typeof a.data.description === 'string' ? a.data.description : undefined,
  }))
  const model: PluginModel = {
    root,
    config,
    skills,
    commands,
    agents,
    hooks: readJsonIfPresent(root, config.components.hooks),
    mcp: readJsonIfPresent(root, config.components.mcp),
  }
  if (config.bootstrap.kind === 'skill') {
    const wanted = config.bootstrap.skill
    if (!skills.some((s) => s.name === wanted)) {
      throw new ConfigError(`bootstrap skill "${wanted}" not found in ${config.components.skills}/`)
    }
  }
  return model
}
