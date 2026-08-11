import { deepMerge } from '../fileset.js'
import type { GeneratedFile } from '../fileset.js'
import type { PluginModel } from '../model.js'
import type { HarnessAdapter, EmitResult } from './types.js'
import { json } from './shared.js'

// Droid, grok, and copilot consume the CLAUDE-style plugin layout via the
// agents-marketplace descriptor — a distribution-only file that declares
// this plugin as installable on Anthropic's agents marketplace. No components
// are emitted; the descriptor is read by install tooling to set up the
// .agents/plugins/ layout.

function marketplaceDescriptor(model: PluginModel): Record<string, unknown> {
  const { config } = model
  const plugins: Array<Record<string, unknown>> = [
    {
      name: config.name,
      source: { source: 'url', url: './' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    },
  ]

  // Add category if configured
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
  emit(model: PluginModel): EmitResult {
    const files: GeneratedFile[] = [
      { path: '.agents/plugins/marketplace.json', content: json(marketplaceDescriptor(model)) },
    ]

    return { files, warnings: [] }
  },
}
