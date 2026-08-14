# everyharness — what it is, who it's for

Generate a coding-agent plugin for every harness from one config file.

> **Status: pre-alpha.** Interfaces, the `everyharness.yaml` schema, and the
> generated formats may change without notice (README, top warning). Read this
> page as a preview of where the tool is headed and what already works today.

## What you get

You wrote a plugin and people liked it. Then they asked for it in their own
coding agent. Claude Code reads `.claude-plugin/plugin.json`. Codex reads
`.codex-plugin/plugin.json`. Gemini CLI wants `gemini-extension.json`, OpenCode
wants a JavaScript plugin file, Pi wants a TypeScript extension, and Hermes
wants YAML plus a Python init file (real generated tree, "Using it" below).
Each format drifts on its own schedule, and every release means editing all of
them by hand. Superpowers, the plugin this tool was extracted from, carried nine
hand-maintained manifest files and four distinct bootstrap mechanisms
(`docs/superpowers/specs/2026-08-10-everyharness-design.md`). A missed edit
ships as a user's broken install.

everyharness gives you one file, `everyharness.yaml`, as the source of truth,
and generates the rest:

- **Native files for 12 harnesses through 11 adapters.** Claude Code, Codex,
  Gemini CLI, Cursor, Copilot CLI, OpenCode, Pi, Kimi Code, Hermes, Devin CLI,
  Factory Droid, and Grok Build CLI. Droid and Grok install through the
  generated agents-marketplace descriptor, and Copilot installs through the
  generated Claude-format marketplace descriptor (`src/adapters/index.ts`,
  `adapters`; `src/adapters/agents-marketplace.ts`, header notes; the
  install-check loop in `checks/run-checks.sh`). Antigravity is on the
  roadmap (README, goal paragraph).
- **Install docs and a support matrix with every generation.** A
  `docs/install/<harness>.md` per adapter and `docs/support-matrix.md`, so your
  users get accurate install steps for their agent without you writing them
  (`src/docs-emit.ts`, `installDocFile`).
- **Bootstrap wiring.** The SessionStart hooks and pointer files that make a
  discovery skill load automatically at session start, synthesized from your
  skill list or pointed at a skill you wrote (`src/bootstrap/generated.ts`,
  `generatedBootstrap`).
- **A scaffold and a converter.** `everyharness init` creates a working
  config in an empty directory (`src/init.ts`, `init`), and
  `everyharness import` converts an existing Claude-format plugin, carrying
  over its metadata fields and its skill, command, agent, hook, and MCP-server
  entries (`src/import.ts`, `importPlugin`).
- **Drift detection for CI.** `everyharness validate` loads your config with
  the same rules `generate` uses, then compares every generated file on disk
  against the hashes recorded in the generation manifest, with distinct exit
  codes for config errors, schema violations, and drift (`src/validate.ts`,
  `validate`; `src/manifest.ts`, `checkDrift`; exit codes assigned in
  `src/cli.ts`, `validate` action).
- **Proof it round-trips a real plugin.** The dogfood test regenerates eight
  of superpowers' hand-maintained manifests from one config and compares them
  semantically. It needs a local superpowers checkout and skips without one
  (`tests/dogfood.test.ts`, `COMPARED_FILES`, `dogfood` describe block).

## Using it

Real session, from a clean directory named `demo-plugin` (`init` names the
plugin after its directory: `src/init.ts`, `init`). everyharness is
unpublished, so the CLI runs from a built checkout; see Getting started:

```
$ node everyharness/dist/cli.js init
created: everyharness.yaml
created: skills/getting-started/SKILL.md
Generated 32 files for initialization
Next: edit everyharness.yaml, then re-run everyharness generate

$ node everyharness/dist/cli.js generate
warning: [kimi] kimi sessionStart requires a named bootstrap skill; generate mode is not supported on kimi
Generated 32 files for 11 harness(es): claude-code, cursor, codex, devin,
kimi, gemini, opencode, pi, hermes, agent-plugins-1.0, agents-marketplace

$ node everyharness/dist/cli.js validate
validate: clean
```

Those 32 files include `.claude-plugin/plugin.json`,
`.codex-plugin/plugin.json`, `gemini-extension.json`,
`.opencode/plugins/demo-plugin.js`, `.pi/extensions/demo-plugin.ts`,
`.hermes-plugin/plugin.yaml`, eleven install docs, the support matrix, and the
bootstrap hook wiring. You commit them; `validate` keeps them honest from then
on.

## Running it

You own a plugin repo and want releases to stay coherent:

- **CI**: run `everyharness validate` on every push. Exit code 1 is a config
  error, 2 is a schema violation, 3 is drift: a generated file hand-edited or
  deleted since the last `generate` (`src/cli.ts`, `validate` action;
  `src/manifest.ts`, `checkDrift`). An edited `everyharness.yaml` whose
  outputs were never regenerated passes validate, so regenerate after every
  config change.
- **Install checks**: `everyharness test` runs two offline tiers inside a
  shared container image: first it parses every generated manifest and checks
  referenced paths exist, then it performs a real install into each harness
  CLI and asserts the CLI enumerates the plugin's skills
  (`checks/run-checks.sh`, header comment). This is the check that catches a
  manifest that parses but is wired to the wrong place.
- **Releases**: `everyharness bump 1.2.3` rewrites the version in
  `everyharness.yaml` and any declared version-bearing files, regenerates all
  manifests, then audits the repo for stray version strings. `bump --check`
  reports versions and drift without writing anything; `bump --audit` runs
  the stray-string scan alone (`src/bump.ts`, `bumpVersion`, `bumpCheck`,
  `bumpAudit`). It replaces per-repo bump scripts.

## Who it's for — and not for

For plugin authors who ship one plugin to several coding agents, and for
maintainers who want manifest drift caught by CI instead of by bug reports.

A plugin that targets one harness and will stay there is better served by its
single hand-written manifest; this tool earns its keep at two harnesses and
up. Teams that need a stable interface today should wait: the project is
pre-alpha and says so (README, top warning).

## Limitations

Each limitation is tagged with who bears it: the plugin author using the
tool, or the maintainer running its guardrails.

- **(author)** Pre-alpha. The config schema and generated formats may change
  without notice, and the package is unpublished on npm, so every install is a
  clone-and-build (README, top warning).
- **(maintainer)** `everyharness test` needs Docker and pulls
  `ghcr.io/prime-radiant-inc/everyharness-container`, a ~15 GB linux/amd64
  image, on first use (README, `everyharness test` section).
- **(maintainer)** Kimi Code, Cursor, and Devin CLI have no offline install
  check; `test` reports them as `skip` (README, `everyharness test` section).
- **(author)** Kimi requires a named bootstrap skill; under
  `bootstrap: generate` the kimi adapter warns and skips its bootstrap wiring
  (observed in the session above; `src/adapters/kimi.ts`).

## Getting started

everyharness is MIT-licensed (`LICENSE`) and needs Node 20 or newer
(`package.json`, `engines`).

**Plugin author** (try it on your plugin):

```bash
git clone https://github.com/prime-radiant-inc/everyharness
cd everyharness && npm install && npm run build
cd ~/your-plugin && node /path/to/everyharness/dist/cli.js import   # existing Claude-format plugin
node /path/to/everyharness/dist/cli.js generate
```

**Maintainer** (wire the guardrails): add `everyharness validate` to CI, run
`everyharness test` before releases, and adopt `everyharness bump` in place of
your version script. The README's Configuration section documents every knob.

Contributors: the design record lives in `docs/superpowers/specs/` and
`docs/superpowers/plans/`.

<!-- The brochure site (docs/index.html) is rendered from this file by
the superpowers-docs documentation skill; re-render on stamp-SHA mismatch
(see the sentinel in docs/index.html). -->

<!-- Deferred claims (ground truth outside this repo): the ~15 GB size of
ghcr.io/prime-radiant-inc/everyharness-container, and the package's
unpublished status on the npm registry. -->

---
<!-- doc-audit:last-reviewed -->
_Last reviewed: 2026-08-13 · commit `e8dccc8` · verified against code (2 claims deferred to review)._
