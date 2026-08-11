import { deepMerge } from '../fileset.js'
import type { GeneratedFile } from '../fileset.js'
import type { PluginModel } from '../model.js'
import type { HarnessAdapter, EmitResult } from './types.js'
import { json } from './shared.js'

// Droid, Grok, and Copilot install the Claude-style layout through this
// descriptor, so their real support profile equals claude-code's — the
// all-'none' support row below reflects only what THIS adapter emits (matrix
// docs clarifying this land in Plan 4). The agents-marketplace descriptor is
// a distribution-only file that declares this plugin as installable on
// Anthropic's agents marketplace. No components are emitted; the descriptor is
// read by install tooling to set up the .agents/plugins/ layout.

function marketplaceDescriptor(model: PluginModel): Record<string, unknown> {
  const { config } = model
  const plugins: Array<Record<string, unknown>> = [
    {
      name: config.name,
      source: { source: 'url', url: './' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    },
  ]

  if (config.marketplace?.category) {
    plugins[0].category = config.marketplace.category
  }

  const descriptor: Record<string, unknown> = {
    name: `${config.name}-dev`,
    interface: { displayName: config.name },
    plugins,
  }

  const override = config.harnesses.overrides['agents-marketplace']
  return override ? (deepMerge(descriptor, override) as Record<string, unknown>) : descriptor
}

// Ground truth per Design decision 4: droid names marketplaces by their source
// (repo/directory basename), not the descriptor's declared name. So:
// - droid: `droid plugin install <name>@<repo-basename>` (droid derives name from source)
// - copilot: `copilot plugin install <name>@<name>-dev` (copilot honors declared name)
// - grok: `grok plugin install <url> --trust` (grok takes a URL/path directly, no marketplace)
function installDoc(model: PluginModel): string {
  const { config } = model
  const url = config.repository ?? '<your-repo>'
  const repoName = config.repository
    ? (config.repository.split('/').pop() ?? '').replace(/\.git$/, '') || '<your-repo>'
    : '<your-repo>'

  const lines = [
    '## What gets emitted',
    '',
    '- `.agents/plugins/marketplace.json`, a distribution-only descriptor (this adapter does not translate any plugin components itself)',
    '',
    '## Installing',
    '',
    'On Factory Droid:',
    '',
    '```',
    `droid plugin marketplace add ${url}`,
    `droid plugin install ${config.name}@${repoName}`,
    '```',
    '',
    'On Copilot:',
    '',
    '```',
    `copilot plugin marketplace add ${url}`,
    `copilot plugin install ${config.name}@${config.name}-dev`,
    '```',
    '',
    'On Grok:',
    '',
    '```',
    `grok plugin install ${url} --trust`,
    '```',
    '',
    "All three clients install the plugin's real claude-code-style layout (skills/, commands/, agents/, hooks/, .mcp.json) that this descriptor points at — their effective support matches claude-code's, not the all-`none` row this adapter reports in the support matrix (which reflects only the descriptor file itself, not what those clients receive through it). Consult each client's docs if these commands don't match your installed version.",
  ]
  return lines.join('\n')
}

export const agentsMarketplace: HarnessAdapter = {
  name: 'agents-marketplace',
  support: {
    skills: 'none',
    commands: 'none',
    agents: 'none',
    hooks: 'none',
    mcp: 'none',
    bootstrap: 'none',
  },
  installDoc,
  emit(model: PluginModel): EmitResult {
    const files: GeneratedFile[] = [
      { path: '.agents/plugins/marketplace.json', content: json(marketplaceDescriptor(model)) },
    ]

    return { files, warnings: [] }
  },
}
