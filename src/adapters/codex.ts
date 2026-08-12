import { deepMerge } from '../fileset.js'
import type { GeneratedFile } from '../fileset.js'
import type { PluginModel } from '../model.js'
import type { HarnessAdapter, EmitResult } from './types.js'
import { baseManifestFields, json } from './shared.js'

function pluginManifest(model: PluginModel): Record<string, unknown> {
  const { config } = model
  const manifest: Record<string, unknown> = { ...baseManifestFields(config) }
  manifest.skills = `./${config.components.skills}/`
  // Codex's loader auto-registers hooks/hooks.json unless the manifest holds
  // a literal empty object here — this avoids duplicate trust prompts.
  manifest.hooks = {}
  const override = config.harnesses.settings.codex?.manifest
  return override ? (deepMerge(manifest, override) as Record<string, unknown>) : manifest
}

// Ground truth per Design decision 4: `/plugins` in Codex CLI or the Codex
// App plugin sidebar — no session hook exists, so there is nothing to name
// as an install-time mechanism beyond native skill discovery.
function installDoc(_model: PluginModel): string {
  const lines = [
    '## What gets emitted',
    '',
    "- `.codex-plugin/plugin.json` (with an empty `hooks` object, which suppresses Codex's automatic `hooks/hooks.json` registration)",
    '',
    '## Installing',
    '',
    'From Codex CLI or the Codex App plugin sidebar:',
    '',
    '```',
    '/plugins',
    '```',
    '',
    "Codex discovers this plugin's skills natively; there is no session-start hook to configure. Consult Codex's plugin docs if this doesn't match your installed version.",
    '',
    '## Caveats',
    '',
    '- Hooks and commands are not supported on Codex; bootstrap relies entirely on native skill discovery, with no active injection mechanism.',
  ]
  return lines.join('\n')
}

export const codex: HarnessAdapter = {
  name: 'codex',
  support: {
    skills: 'full',
    commands: 'none',
    agents: 'none',
    hooks: 'none',
    mcp: 'none',
    bootstrap: 'partial',
  },
  installDoc,
  emit(model: PluginModel): EmitResult {
    const warnings: string[] = []
    const files: GeneratedFile[] = [{ path: '.codex-plugin/plugin.json', content: json(pluginManifest(model)) }]

    if (model.hooks !== undefined) {
      warnings.push('hooks are not supported on codex; bootstrap relies on native skill discovery')
    }
    if (model.commands.length) warnings.push('commands are not supported on codex (no plugin-shipped prompt mechanism)')
    if (model.agents.length) warnings.push('agents are not emitted for codex in v1')
    if (model.mcp !== undefined) warnings.push('mcp servers are not emitted for codex in v1')

    return { files, warnings }
  },
}
