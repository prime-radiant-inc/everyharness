import { deepMerge } from '../fileset.js'
import type { GeneratedFile } from '../fileset.js'
import type { PluginModel } from '../model.js'
import type { HarnessAdapter, EmitResult } from './types.js'
import { sessionStartScript, runHookCmd } from '../bootstrap/shell-hook.js'
import { generatedBootstrap, GENERATED_BOOTSTRAP_PATH } from '../bootstrap/generated.js'
import { baseManifestFields, json } from './shared.js'

// Where the cursor adapter emits the bootstrap SessionStart hook and its
// hooks-cursor.json, when config.bootstrap.kind === 'skill'. Shares the
// hooks/everyharness directory (and the session-start/run-hook.cmd files)
// with claude-code so the two adapters can coexist without duplication.
const BOOTSTRAP_HOOKS_DIR = 'hooks/everyharness'
const BOOTSTRAP_HOOKS_JSON_PATH = `${BOOTSTRAP_HOOKS_DIR}/hooks-cursor.json`

function pluginManifest(model: PluginModel): Record<string, unknown> {
  const { config } = model
  // Splice displayName after name and swap description/version ahead of the
  // author/homepage/.../keywords tail (which already matches
  // baseManifestFields' order) to keep cursor's on-disk field order
  // byte-identical to its pre-refactor output.
  const { version, description, ...rest } = baseManifestFields(config)
  const manifest: Record<string, unknown> = {
    name: config.name,
    displayName: config.name,
    description,
    version,
    ...rest,
  }
  manifest.skills = `./${config.components.skills}/`
  if (config.bootstrap.kind === 'skill' || config.bootstrap.kind === 'generate') {
    manifest.hooks = `./${BOOTSTRAP_HOOKS_JSON_PATH}`
  }
  const override = config.harnesses.overrides.cursor
  return override ? (deepMerge(manifest, override) as Record<string, unknown>) : manifest
}

function hooksManifest(): Record<string, unknown> {
  return {
    version: 1,
    hooks: {
      sessionStart: [{ command: `./${BOOTSTRAP_HOOKS_DIR}/run-hook.cmd session-start` }],
    },
  }
}

export const cursor: HarnessAdapter = {
  name: 'cursor',
  support: {
    skills: 'full',
    commands: 'none',
    agents: 'none',
    hooks: 'partial',
    mcp: 'none',
    bootstrap: 'full',
  },
  emit(model: PluginModel): EmitResult {
    const { config } = model
    const warnings: string[] = []
    const files: GeneratedFile[] = [{ path: '.cursor-plugin/plugin.json', content: json(pluginManifest(model)) }]

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
        { path: BOOTSTRAP_HOOKS_JSON_PATH, content: json(hooksManifest()) },
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
        { path: BOOTSTRAP_HOOKS_JSON_PATH, content: json(hooksManifest()) },
      )
    }

    if (model.hooks !== undefined) warnings.push('user hooks are not translated for cursor in v1')
    if (model.commands.length) warnings.push('commands are not emitted for cursor in v1')
    if (model.agents.length) warnings.push('agents are not emitted for cursor in v1')
    if (model.mcp !== undefined) warnings.push('mcp servers are not emitted for cursor in v1')

    return { files, warnings }
  },
}
