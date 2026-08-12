import { deepMerge } from '../fileset.js'
import type { GeneratedFile } from '../fileset.js'
import type { PluginModel } from '../model.js'
import type { HarnessAdapter, EmitResult } from './types.js'
import { baseManifestFields, json } from './shared.js'

// Ground truth per Design decision 4: `/plugins install URL` inside Kimi
// Code, or the Kimi marketplace, with URL substituted from
// config.repository (falling back to `<your-repo>` when absent — never a
// fabricated listing).
function installDoc(model: PluginModel): string {
  const { config } = model
  const url = config.repository ?? '<your-repo>'

  const emitted = ['`.kimi-plugin/plugin.json`']
  if (config.bootstrap.kind === 'skill') {
    emitted.push("the manifest's `sessionStart.skill` field, naming the configured bootstrap skill")
  }

  const lines = [
    '## What gets emitted',
    '',
    ...emitted.map((e) => `- ${e}`),
    '',
    '## Installing',
    '',
    '```',
    `/plugins install ${url}`,
    '```',
    '',
    "Or find it through the Kimi marketplace. Consult Kimi Code's plugin docs if this command doesn't match your installed version.",
  ]
  if (config.bootstrap.kind === 'generate') {
    lines.push(
      '',
      '## Caveats',
      '',
      "- Kimi's `sessionStart` only supports a named bootstrap skill; `bootstrap.generate` is not supported on Kimi.",
    )
  }
  return lines.join('\n')
}

function pluginManifest(model: PluginModel): Record<string, unknown> {
  const { config } = model
  const manifest: Record<string, unknown> = { ...baseManifestFields(config) }
  manifest.skills = `./${config.components.skills}/`
  if (config.bootstrap.kind === 'skill') {
    manifest.sessionStart = { skill: config.bootstrap.skill }
  }
  const override = config.harnesses.settings.kimi?.manifest
  return override ? (deepMerge(manifest, override) as Record<string, unknown>) : manifest
}

export const kimi: HarnessAdapter = {
  name: 'kimi',
  support: {
    skills: 'full',
    commands: 'none',
    agents: 'none',
    hooks: 'none',
    mcp: 'none',
    bootstrap: 'partial', // sessionStart only supports a named bootstrap skill; bootstrap.generate is unsupported
  },
  installDoc,
  emit(model: PluginModel): EmitResult {
    const { config } = model
    const warnings: string[] = []
    const files: GeneratedFile[] = [{ path: '.kimi-plugin/plugin.json', content: json(pluginManifest(model)) }]

    if (config.bootstrap.kind === 'generate') {
      warnings.push('kimi sessionStart requires a named bootstrap skill; generate mode is not supported on kimi')
    }

    if (model.hooks !== undefined) warnings.push('hooks are not emitted for kimi')
    if (model.commands.length) warnings.push('commands are not emitted for kimi')
    if (model.agents.length) warnings.push('agents are not emitted for kimi')
    if (model.mcp !== undefined) warnings.push('mcp servers are not emitted for kimi')

    return { files, warnings }
  },
}
