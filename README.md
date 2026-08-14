# everyharness

> [!WARNING]
> **Work in progress — pre-alpha.** The v1 feature set is complete: eleven harness adapters, init/import, generated install docs, and container-backed install checks. Not yet published to npm; interfaces may still change. Everything — including the
> `everyharness.yaml` schema and the generation-manifest format — may change
> without notice. Don't depend on this yet.

Generate a coding-agent plugin for every harness from one config file.

What it is and who it's for: [docs/BROCHURE.md](docs/BROCHURE.md).

The goal: one `everyharness.yaml` as the source of truth, with
`everyharness generate` emitting native plugin manifests, bootstrap wiring,
docs, and tests for every supported coding-agent harness (Claude Code, Codex,
Gemini CLI, Cursor, Copilot CLI, OpenCode, Pi, Kimi Code, Hermes, Devin CLI,
Factory Droid, Grok Build CLI, Antigravity). Generated files are committed;
`everyharness validate` catches drift in CI.

## Usage

```bash
npx everyharness init       # scaffold a new plugin
npx everyharness import     # convert an existing Claude-format plugin
npx everyharness generate   # emit per-harness files from everyharness.yaml
npx everyharness validate   # drift + schema checks (exit 1 = config error, 3 = drift, 2 = schema)
npx everyharness matrix     # component-support matrix
npx everyharness test       # container-backed offline install checks (needs docker; exit 2 = failed checks)
npx everyharness bump 1.2.3 # set the version everywhere + regenerate (also --check / --audit; reads release:)
```

`everyharness test` runs two offline tiers inside the container: first it parses every generated harness manifest and confirms referenced paths exist, then it performs a **real install** of the plugin into each harness CLI (claude, codex, gemini, opencode, grok, droid, hermes, copilot, pi) and asserts the CLI actually enumerates the plugin's skills — the check that catches a manifest that parses but is wired to the wrong place. Harnesses with no offline enumeration path (kimi, cursor, devin) are reported as `skip`. It pulls ghcr.io/prime-radiant-inc/everyharness-container on first use (large image, ~15GB, linux/amd64) — prefetch with `docker pull` if you want progress control.

**Current status: generation works via 11 adapters covering 13 harnesses; `init` scaffolds, `import` converts Claude-format plugins, every generation emits install docs + a support matrix, and `everyharness test` runs offline manifest checks plus real per-harness install + skill-enumeration checks for all harnesses inside the shared container image (ghcr.io/prime-radiant-inc/everyharness-container). The superpowers dogfood test regenerates all eight of superpowers' hand-maintained manifests, semantically identical (JSON key order and formatting are explicitly not compared).**

## Configuration

`everyharness.yaml` has four sections, and each has one job: the top-level
keys describe the plugin; `harnesses.<name>` holds per-harness behavior and
manifest patches; `marketplace` is the distribution descriptor; `release` is
version-bump bookkeeping.

### `bootstrap`

The optional `bootstrap` key wires a plugin's discovery skill (or a generated
equivalent) into every harness. It's a tagged value — exactly one of three
forms:

```yaml
bootstrap: generate                       # synthesize a bootstrap file from the plugin's skill list
# bootstrap: none                         # skip bootstrap wiring entirely (same as omitting the key)
# bootstrap: { skill: using-my-plugin }   # point at a hand-written skill; object form only when a parameter is needed
```

- **`generate`** — string literal. everyharness synthesizes a bootstrap file
  from the plugin's skill list instead of pointing at a hand-written skill.
- **`none`** — string literal, same as omitting `bootstrap` entirely. Skips
  bootstrap wiring.
- **`{ skill: <name> }`** — object form. `<name>` is a skill (under
  `components.skills`) invoked as the bootstrap; generation fails if the
  skill doesn't exist.

Whether claude-code and cursor (the harnesses with a shell-hook tier) emit
their own generated SessionStart hook and merged `hooks.json` /
`hooks-cursor.json` pointer is controlled per-harness under `harnesses.<name>.hooks`,
not here — see below.

### `harnesses`

The `harnesses` block holds everything harness-specific: which harnesses to
skip, whether a harness emits its own hooks instead of the generated ones,
and per-harness patches to that harness's generated manifest.

```yaml
harnesses:
  exclude: [devin]              # skip these harnesses entirely
  claude-code:
    hooks: own                  # 'generated' (default) | 'own'
    manifest:
      repository: null          # null deletes the inherited field
  kimi:
    manifest:
      displayName: Kimi Code
```

- **`exclude`** — harness names to skip generation for entirely.
- **`<name>.hooks`** — `generated` (default) or `own`. Set `own` when a
  plugin hand-crafts its own hooks for this harness and wants everyharness to
  leave that harness's hooks wiring alone: everyharness emits no hook files
  and forces no manifest hooks pointer for it. Only valid on hook-emitting
  harnesses (`claude-code`, `cursor`), and only when `bootstrap` is
  `generate` or `{ skill: ... }` — under `bootstrap: none` there are no
  generated hooks to suppress, so it's a config error.
- **`<name>.manifest`** — patches deep-merged into that harness's generated
  manifest, on top of the top-level config fields. Arrays and scalars are
  replaced wholesale; objects are merged recursively. A literal `null` at any
  nesting depth is always a **delete sentinel** that removes the inherited
  field — essential when a field is required for some harnesses but must be
  absent in others (e.g. kimi's plugin.json format doesn't include
  `repository`, while claude-code's does). Because of this, a literal `null`
  value can't be set through `manifest` at all; emit it via an adapter's
  custom field logic instead. (Arrays are replaced wholesale, so a `null`
  entry inside an array passes through unaffected.)

Any key under `harnesses:` other than `exclude` must be a known adapter name
(the registry in `src/adapters/index.ts`) — an unrecognized name is a config
error naming the key and the valid set.

### `marketplace`

The optional `marketplace` block shapes the Claude Code marketplace descriptor
(`.claude-plugin/marketplace.json`) and the generated install doc. Every field
is optional; omit the block entirely to get the local-dev defaults.

```yaml
marketplace:
  name: my-plugin-market            # marketplace listing name; default <name>-dev
  description: My plugin's channel  # default "Development marketplace for <name>"
  source: local                     # local (default) | repository | an http(s) URL
  strict: true                      # emitted on the plugin entry only when set
  category: Developer Tools         # optional listing category
  tags: [demo, fixture]             # optional listing keywords
```

- **`name`** — the marketplace's listing name. Install ids are
  `<plugin>@<name>`. Default: `<name>-dev`.
- **`description`** — the marketplace description. Default:
  `Development marketplace for <name>`.
- **`source`** — where the plugin entry is installed from. `local` (default)
  emits `source: "./"` (the plugin lives in this repo). `repository` emits a
  URL source pointing at the top-level `repository` field — so **`source:
  repository` requires a top-level `repository`** and generation fails without
  it. An explicit `http(s)://` URL is used verbatim as the URL source.
- **`strict`** — emitted on the plugin entry only when set (`true` or `false`);
  omitted otherwise.
- **`category`** / **`tags`** — optional listing metadata (`tags` becomes the
  entry's `keywords`).

Design: `docs/superpowers/specs/2026-08-10-everyharness-design.md`.

### `release`

The CLI command is still `everyharness bump`; it reads the `release:` block.
`bump` sets the plugin version in one place and propagates it — the
replacement for per-repo bump scripts like superpowers'
`scripts/bump-version.sh`. Because `everyharness.yaml` is the version source of
truth and `generate` rebuilds every harness manifest from it, you never list
those generated files here: bump rewrites `everyharness.yaml`, then regenerates.
The `release` block only names the extra, *non-generated* files that also carry
the version.

```yaml
release:
  files:
    - { path: release.json, field: version }   # a version-bearing file everyharness does not generate
      # note: package.json is usually generated (by the opencode/pi adapters) — declaring
      # a generated file here is a ConfigError; generate already bumps those
  audit:
    exclude:
      - CHANGELOG.md                            # files the audit should ignore (glob, matched per path segment)
      - "*.lock"
```

- **`files`** — extra files to rewrite, each a `{ path, field }` where `field`
  is a dotted path (`version`, `plugins.0.version`) that must already exist as a
  string in a `.json`, `.yaml`, or `.yml` file. everyharness.yaml is always
  bumped and is not listed here.
- **`audit.exclude`** — glob patterns the `--audit` scan skips. A pattern is
  matched against the basename or any single path segment (grep
  `--exclude`/`--exclude-dir` semantics). A pattern containing `/` (e.g.
  `docs/CHANGELOG.md`) never matches anything, since no single segment
  contains a `/` — exclude by basename or directory name instead.

Three modes, exactly one per invocation:

```bash
everyharness bump 1.2.3   # rewrite everyharness.yaml + declared files, regenerate, then audit
everyharness bump --check # print each version and detect drift
everyharness bump --audit # scan the repo for stray occurrences of the current version
```

- **`bump <version>`** validates the version against the schema's semver rule,
  rewrites everyharness.yaml (comments preserved) and every declared file,
  regenerates all harness manifests, then runs the audit. Missing declared files
  are reported as `SKIP (missing)`.
- **`--check`** prints each declared file's version (or `MISSING`) plus
  `everyharness.yaml`, and flags drift when versions disagree, a declared file
  is missing, or a generated file no longer matches the manifest.
- **`--audit`** greps every non-generated, non-declared, non-excluded text file
  for the current version string and reports occurrences you may have missed.

Exit codes: `0` clean, `1` config error, `3` drift (from `--check`). `--audit`
is advisory and always exits `0`.

## License

MIT
