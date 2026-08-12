import { deepMerge } from '../fileset.js'
import type { GeneratedFile } from '../fileset.js'
import type { PluginModel } from '../model.js'
import type { HarnessAdapter, EmitResult } from './types.js'
import { baseManifestFields, json, githubOwnerRepo } from './shared.js'

function pluginManifest(model: PluginModel): Record<string, unknown> {
  const { config } = model
  const manifest = baseManifestFields(config)
  const override = config.harnesses.settings.devin?.manifest
  return override ? (deepMerge(manifest, override) as Record<string, unknown>) : manifest
}

// Ground truth per Design decision 4: `devin plugins install REPO`, with
// REPO substituted from config.repository when it's a github.com URL and a
// `<your-repo>` placeholder otherwise (never a fabricated listing).
function installDoc(model: PluginModel): string {
  const { config } = model
  const repo = githubOwnerRepo(config.repository) ?? '<your-repo>'

  const lines = [
    '## What gets emitted',
    '',
    '- `.devin-plugin/plugin.json`',
    '',
    '## Installing',
    '',
    '```',
    `devin plugins install ${repo}`,
    '```',
    '',
    "Consult Devin's plugin docs if this command doesn't match your installed version.",
    '',
    '## Caveats',
    '',
    '- Devin has no documented bootstrap-injection mechanism; skills are available for the agent to discover, but nothing actively points it at them at session start.',
  ]
  return lines.join('\n')
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
  installDoc,
  emit(model: PluginModel): EmitResult {
    const warnings: string[] = []
    const files: GeneratedFile[] = [{ path: '.devin-plugin/plugin.json', content: json(pluginManifest(model)) }]

    if (model.hooks !== undefined) warnings.push('hooks are not emitted for devin')
    if (model.commands.length) warnings.push('commands are not emitted for devin')
    if (model.agents.length) warnings.push('agents are not emitted for devin')
    if (model.mcp !== undefined) warnings.push('mcp servers are not emitted for devin')

    return { files, warnings }
  },
}
