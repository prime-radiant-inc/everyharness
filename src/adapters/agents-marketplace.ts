import { deepMerge } from '../fileset.js'
import type { GeneratedFile } from '../fileset.js'
import type { PluginModel } from '../model.js'
import type { HarnessAdapter, EmitResult } from './types.js'
import { json, marketplaceName } from './shared.js'

// Droid and Grok install the Claude-style layout through this descriptor, so
// their real support profile equals claude-code's — the all-'none' support row
// below reflects only what THIS adapter emits (matrix docs clarifying this land
// in Plan 4). The agents-marketplace descriptor is a distribution-only file
// that declares this plugin as installable on Anthropic's agents marketplace.
// No components are emitted; the descriptor is read by install tooling to set
// up the .agents/plugins/ layout.
//
// Copilot is different: CONFIRMED (2026-08-12, empirical, GitHub Copilot CLI
// 1.0.78 in the everyharness container) that `copilot plugin marketplace add`
// reads ONLY Claude Code's marketplace descriptor — it searches marketplace.json,
// .plugin/marketplace.json, .github/plugin/marketplace.json, and
// .claude-plugin/marketplace.json, and never looks at .agents/plugins/. So
// Copilot registers the marketplace under the name declared in
// .claude-plugin/marketplace.json (i.e. marketplaceName()), NOT this
// descriptor's `-dev` name, and its effective support still equals claude-code's
// because that is the layout it actually installs.

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
// - copilot: `copilot plugin install <name>@<marketplace-name>`, where
//   <marketplace-name> is marketplaceName() — the name from
//   .claude-plugin/marketplace.json, the ONLY descriptor Copilot reads (see the
//   file header). It is NOT this adapter's `.agents/plugins/marketplace.json`
//   name (always `-dev`). Edge: if the claude-code adapter is excluded, no
//   .claude-plugin/marketplace.json is emitted and `copilot plugin marketplace
//   add` fails outright (verified) — Copilot has no path through this descriptor,
//   so this line assumes claude-code is present, as it is by default.
// - grok: `grok plugin install <url> --trust` (grok takes a URL/path directly, no marketplace)
function installDoc(model: PluginModel): string {
  const { config } = model
  const url = config.repository ?? '<your-repo>'
  const repoName = config.repository
    ? (config.repository.replace(/\/+$/, '').split('/').pop() ?? '').replace(/\.git$/, '') || '<your-repo>'
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
    'Note: Droid names the marketplace after the repository source (its basename), not the descriptor\'s declared name — so the install id differs from Copilot\'s.',
    '',
    'On Copilot:',
    '',
    '```',
    `copilot plugin marketplace add ${url}`,
    `copilot plugin install ${config.name}@${marketplaceName(config)}`,
    '```',
    '',
    'On Grok:',
    '',
    '```',
    `grok plugin install ${url} --trust`,
    '```',
    '',
    "All three clients install the plugin's real claude-code-style layout (skills/, commands/, agents/, hooks/, .mcp.json) — their effective support matches claude-code's, not the all-`none` row this adapter reports in the support matrix (which reflects only the descriptor file itself, not what those clients receive through it). Droid and Grok read the descriptor this adapter emits (`.agents/plugins/marketplace.json`); Copilot instead reads Claude Code's `.claude-plugin/marketplace.json`, so its install id above uses that marketplace's name and it needs the claude-code adapter enabled. Consult each client's docs if these commands don't match your installed version.",
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
