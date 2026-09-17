import { deepMerge } from '../fileset.js'
import type { GeneratedFile } from '../fileset.js'
import type { PluginModel } from '../model.js'
import type { HarnessAdapter, EmitResult } from './types.js'
import { sessionStartScript, runHookCmd } from '../bootstrap/shell-hook.js'
import { generatedBootstrap, GENERATED_BOOTSTRAP_PATH } from '../bootstrap/generated.js'
import { baseManifestFields, json, bootstrapEmitsHooks } from './shared.js'

// Muse native plugin lives at .muse-plugin/plugin.json with a SessionStart
// hook that injects the bootstrap skill. Reuses the shared
// hooks/everyharness/session-start + run-hook.cmd bootstrap tier with
// claude-code/cursor so the three adapters coexist (same files, same
// session-start content now handles MUSE_PLUGIN_ROOT with nested
// hookSpecificOutput).
const BOOTSTRAP_HOOKS_DIR = 'hooks/everyharness'

function pluginManifest(model: PluginModel): Record<string, unknown> {
  const { config } = model
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    name: config.name,
    displayName: config.name,
    version: config.version,
    description: config.description,
    compat: {
      source: 'native',
      manifestDir: '.muse-plugin',
    },
    capabilities: {
      skills: model.skills.map((s) => ({
        id: s.name,
        path: `skills/${s.name}/SKILL.md`,
      })),
      commands: [],
      hooks: bootstrapEmitsHooks(config, muse.name)
        ? [
            {
              id: 'session-start',
              event: 'SessionStart',
              command: ['sh', `${BOOTSTRAP_HOOKS_DIR}/session-start`],
              timeoutMs: 5000,
            },
          ]
        : [],
      mcpServers: [],
      reminders: [],
    },
  }
  const override = config.harnesses.settings.muse?.manifest
  return override ? (deepMerge(manifest, override) as Record<string, unknown>) : manifest
}

function installDoc(model: PluginModel): string {
  const { config } = model
  const bootstrapActive = bootstrapEmitsHooks(config, muse.name)

  const emitted = ['`.muse-plugin/plugin.json`']
  if (bootstrapActive) {
    emitted.push(`the \`${BOOTSTRAP_HOOKS_DIR}\` bootstrap hook (\`session-start\` + \`run-hook.cmd\`)`)
  }
  if (config.bootstrap.kind === 'generate') {
    emitted.push(`the generated bootstrap file at \`${GENERATED_BOOTSTRAP_PATH}\``)
  }

  const lines = [
    '## What gets emitted',
    '',
    ...emitted.map((e) => `- ${e}`),
    '',
    '## Installing',
    '',
    '```bash',
    'muse plugins install ./',
    'muse plugins approve superpowers',
    '```',
    '',
    `Or clone and install: \`git clone ${config.repository ?? 'https://github.com/owner/repo.git'} && muse plugins install ./\` + \`muse plugins approve ${config.name}\`.`,
    '',
    bootstrapActive
      ? `Muse registers the \`SessionStart\` bootstrap hook — \`using-${config.name}\` (or the generated bootstrap) is injected automatically every session with no per-session opt-in, alongside the other harnesses. Hooks require approval on first install (\`muse plugins approve ${config.name}\`); skills are active immediately. Restart any active Muse sessions after installing to pick up the hook.`
      : 'Skills are registered natively; no bootstrap hook is emitted for this configuration.',
    '',
    '## Caveats',
    '',
    '- `muse plugins install` validates the plugin — `muse plugins validate ./` should report `valid` with at most the expected `multiple-manifests` warning when the repo also ships other harness manifests.',
    '- Hooks share the `hooks/everyharness` directory with Claude Code and Cursor so the three adapters coexist; the `session-start` script handles `MUSE_PLUGIN_ROOT` with nested `hookSpecificOutput` (Muse Spark requires nested, not top-level `additionalContext`).',
  ]
  return lines.join('\n')
}

export const muse: HarnessAdapter = {
  name: 'muse',
  support: {
    skills: 'full',
    commands: 'none',
    agents: 'none',
    hooks: 'full',
    mcp: 'none',
    bootstrap: 'full',
  },
  installDoc,
  emit(model: PluginModel): EmitResult {
    const warnings: string[] = []
    const files: GeneratedFile[] = [{ path: '.muse-plugin/plugin.json', content: json(pluginManifest(model)) }]

    const bootstrapActive = bootstrapEmitsHooks(model.config, muse.name)
    if (bootstrapActive) {
      const bootstrapPath = model.config.bootstrap.kind === 'skill'
        ? `skills/${model.config.bootstrap.skill}/SKILL.md`
        : GENERATED_BOOTSTRAP_PATH
      files.push(
        { path: `${BOOTSTRAP_HOOKS_DIR}/session-start`, content: sessionStartScript({ pluginName: model.config.name, bootstrapContentPath: bootstrapPath }), executable: true },
        { path: `${BOOTSTRAP_HOOKS_DIR}/run-hook.cmd`, content: runHookCmd(), executable: true },
      )
      if (model.config.bootstrap.kind === 'generate') {
        files.push({ path: GENERATED_BOOTSTRAP_PATH, content: generatedBootstrap(model) })
      }
    } else {
      // No bootstrap hook to emit, but still need to warn if components exist that Muse doesn't emit
      if (model.commands.length) warnings.push('commands are not emitted for muse')
      if (model.agents.length) warnings.push('agents are not emitted for muse')
      if (model.mcp !== undefined) warnings.push('mcp servers are not emitted for muse')
    }

    if (model.commands.length && bootstrapActive) warnings.push('commands are not emitted for muse')
    if (model.agents.length) warnings.push('agents are not emitted for muse')
    if (model.mcp !== undefined) warnings.push('mcp servers are not emitted for muse')
    if (model.hooks !== undefined) warnings.push('hooks are not emitted for muse (bootstrap SessionStart hook is the only hook)')

    return { files, warnings }
  },
}
