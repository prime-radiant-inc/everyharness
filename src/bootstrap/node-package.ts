import type { PluginModel } from '../model.js'

// Repo-relative path (no leading `./`) of the OpenCode plugin file for a
// plugin named `name`. Shared by nodePackageManifest's `main` field and the
// opencode adapter's own emitted file path, so the two can never drift.
export function opencodePluginPath(name: string): string {
  return `.opencode/plugins/${name}.js`
}

// Repo-relative path (no leading `./`) of the Pi extension file for a
// plugin named `name`. Shared by nodePackageManifest's `pi.extensions`
// field and the (Task 4) pi adapter's own emitted file path.
export function piExtensionPath(name: string): string {
  return `.pi/extensions/${name}.ts`
}

// Root package.json shared by the opencode and pi adapters (Design decision
// 3). Both harnesses resolve their runtime entry point through npm-style
// package.json fields -- `main` for OpenCode's plugin loader, `pi` for Pi's
// extension/skill discovery -- so this single builder emits BOTH fields
// unconditionally, even when only one of the two adapters is active. That
// keeps the two adapters' generated package.json byte-identical, so the
// Plan 2 dedupe step collapses them into one file instead of raising a
// "both adapters emit this path" conflict. A dangling `main` or `pi` field
// is harmless when the corresponding harness isn't in use.
export function nodePackageManifest(model: PluginModel): Record<string, unknown> {
  const { config } = model
  return {
    name: config.name,
    version: config.version,
    description: config.description,
    type: 'module',
    main: `./${opencodePluginPath(config.name)}`,
    pi: {
      extensions: [`./${piExtensionPath(config.name)}`],
      skills: [`./${config.components.skills}`],
    },
    keywords: [...(config.keywords ?? []), 'pi-package'],
  }
}
