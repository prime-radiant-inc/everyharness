# everyharness — Design

**Date:** 2026-08-10
**Status:** Approved by Jesse (interactive brainstorming session)

## Problem

Superpowers supports 12+ coding-agent harnesses (Claude Code, Codex, Gemini CLI, Cursor, Copilot CLI, OpenCode, Pi, Kimi Code, Hermes, Devin CLI, Factory Droid, Grok Build CLI, Antigravity) through hand-maintained per-harness adapters: 9 manifest files, 4 distinct bootstrap mechanisms, per-harness tool mappings, tests, and install docs. Every new plugin that wants multi-harness support must redo that work by hand, and hand-maintained manifests drift.

We want a tool that takes a single plugin config file and generates a plugin for every supported harness — manifests, bootstrap wiring, component translations, install docs, and tests — and that can take an existing single-harness plugin and make it omni-platform.

## Decisions (settled during brainstorming)

1. **Full component coverage.** Skills, commands, agents, hooks, and MCP servers all translate wherever a target harness has an analog. Where none exists, generation reports it honestly (support matrix), never silently drops it.
2. **Regenerable build step.** Generated files are committed to the plugin repo. Re-running the tool updates them; hashes recorded at generation time let `validate` detect drift and hand-edits. Not a one-shot scaffolder, not a runtime shim.
3. **Custom config is the single source of truth.** `everyharness.yaml` at the plugin root drives everything. The Claude `.claude-plugin/plugin.json` is a generated artifact like every other harness manifest. `everyharness import` bootstraps `everyharness.yaml` from an existing Claude-format plugin.
4. **TypeScript on Node**, distributed via npm (`npx everyharness`). CLI binary: `everyharness`.
5. **All 12+ harnesses in v1, tiered depth.** Real per-harness research for every component type, proven by a kitchen-sink fixture plugin that exercises every feature.
6. **In-repo marketplace descriptors only** (v1). Multi-plugin marketplace-repo generation is out of scope.
7. **Design for superpowers dogfooding.** The config schema and overrides must be expressive enough to eventually regenerate superpowers' own adapters. V1 does not migrate superpowers, but carries an integration test comparing generated manifests against superpowers' real ones.
8. **Architecture: adapter-pack generator.** `everyharness.yaml` → normalized plugin model → per-harness TypeScript adapter modules, each emitting its file set. Agent Plugins 1.0 (the cross-vendor spec, shipped 2026-08-06) is one adapter among the natives, not the source format.

## Repos

Two new public MIT repos under `prime-radiant-inc`:

### everyharness

The tool: TypeScript npm package, CLI `everyharness`, adapter modules, templates, kitchen-sink fixture, docs. (Name note: "omniplatform-agent-plugin" was the original working name, dropped because omniplatform-adjacent names were taken; npm package, CLI, and repo all share the name `everyharness`.)

### everyharness-container

The multi-harness container, extracted from `prime-radiant-inc/superpowers-evals` `container/` (Dockerfile installing ~17 harness CLIs, slim variant, helper scripts), plus a GitHub Actions workflow publishing versioned images to GHCR. Two consumers: this tool's phase-2 install testing, and superpowers-evals (migration is a later, separate task in that repo).

## Source of truth: everyharness.yaml

```yaml
name: my-plugin
version: 1.2.0
description: One-line description
author: { name: ..., email: ..., url: ... }
license: MIT
repository: https://github.com/me/my-plugin
keywords: [...]

bootstrap:                  # session-start injection; exactly one mode
  skill: using-my-plugin    # inject this skill's content at session start
  # generate: true          # OR auto-generate a minimal bootstrap listing the plugin's skills
  # none: true              # OR rely on native skill discovery only

components:                 # paths to harness-agnostic sources (Claude formats)
  skills: skills/
  commands: commands/
  agents: agents/
  hooks: hooks/hooks.json
  mcp: mcp.json

harnesses:
  exclude: []               # default: generate for all supported harnesses
  overrides:                # per-harness escape hatch; arbitrary manifest fragments
    codex:
      interface: { ... }    # e.g. Codex portal metadata

marketplace:                # feeds in-repo marketplace descriptors
  category: ...
  tags: [...]
```

The tool parses this plus the actual component files (SKILL.md frontmatter, command/agent markdown, hooks.json, mcp.json) into a normalized internal plugin model consumed by all adapters. `harnesses.overrides` is the expressiveness valve that makes superpowers dogfooding credible (deep-merged into that adapter's emitted manifests).

## CLI

| Command | Purpose |
|---|---|
| `everyharness init` | Scaffold a new plugin: everyharness.yaml, component dirs, starter skill |
| `everyharness import` | Read an existing plugin (Claude format in v1) and write everyharness.yaml — the "make an existing plugin omni-platform" path |
| `everyharness generate` | Emit all per-harness adapters, manifests, docs, and tests; records file hashes and executable bits in `.everyharness/manifest.json` |
| `everyharness validate` | Drift check against the generation manifest; schema validation (SchemaStore, Agent Plugins spec schemas); layout lint; shells out to `claude plugin validate --strict` when available |
| `everyharness matrix` | Print the component-support matrix: what translates where, what is dropped and why |
| `everyharness test` | Phase 2: container-based install/smoke tests per harness |

Generated files carry a "GENERATED by everyharness — edit everyharness.yaml instead" header where the format permits; `validate` catches drift either way.

## Adapter architecture

Each target harness is a self-contained TypeScript module implementing one interface:

```ts
interface HarnessAdapter {
  name: string
  emit(model: PluginModel): FileSet
  validate(files: FileSet): ValidationResult
  installDoc(model: PluginModel): string
  testFiles(model: PluginModel): FileSet
}
```

Adding a harness means adding one module + templates + support-matrix entries; core is untouched.

### Adapters at launch

| Adapter | Emits |
|---|---|
| claude-code | `.claude-plugin/plugin.json` + `marketplace.json`, commands/agents/skills wiring, `hooks/hooks.json`, MCP config |
| agent-plugins-1.0 | Spec-conforming root `plugin.json`, `skills/`, `mcp.json` — covers skills+MCP on Codex, Cursor, Copilot, VS Code, Kiro, ChatGPT |
| codex | `.codex-plugin/plugin.json` (portal `interface` metadata via overrides), `agents/openai.yaml` seeding, custom prompts from commands |
| gemini | `gemini-extension.json`, `GEMINI.md` with `@`-includes, commands → Gemini custom-command TOML, MCP servers |
| cursor | `.cursor-plugin/plugin.json`, `hooks-cursor.json` variant |
| copilot | Shared shell-hook path + marketplace descriptor (consumes Claude-style layout) |
| opencode | `.opencode/plugins/<name>.js` from template (with bootstrap-caching guards), commands → `.opencode/command/*.md`, agents → `.opencode/agent/*.md` |
| pi | `.pi/extensions/<name>.ts`, `package.json` `pi.*` fields |
| kimi | `.kimi-plugin/plugin.json` with `sessionStart.skill` + inline tool-mapping instructions |
| hermes | `.hermes-plugin/plugin.yaml` + `__init__.py` (skill registration + `pre_llm_call` bootstrap) |
| devin | `.devin-plugin/plugin.json` |
| antigravity | Shell-hook reuse + install doc |
| droid / grok | Covered via in-repo marketplace descriptors; install docs only |

### Bootstrap

The polyglot `session-start` shell hook (tri-format JSON emitter serving Claude/Cursor/Copilot/Antigravity, plus `run-hook.cmd` for Windows) is generalized from superpowers into a parameterized template. Config modes: `skill:` injects a named skill; `generate: true` emits a minimal auto-bootstrap ("this plugin provides skills X, Y, Z — invoke before relevant work"); `none` relies on native discovery.

### Component-support matrix

Maintained as data (`support-matrix.ts`), rendered by `everyharness matrix` and into generated docs. The per-harness research (which harnesses have command/agent/hook analogs, exact formats) happens during implementation, one adapter at a time, verified against the kitchen-sink fixture. The matrix records proven findings, never assumptions. Unsupported component/harness combinations generate warnings with matrix references — honest degradation is a feature.

## Testing

### The tool itself (TDD, vitest)

- **Unit tests** per adapter: model in → files out, exact manifest-content assertions.
- **Snapshot tests**: kitchen-sink fixture (`fixtures/kitchen-sink/` — skills, commands, agents, hooks, an MCP server, a bootstrap skill, per-harness overrides) generated for all adapters; output tree snapshotted so template changes produce reviewable diffs.
- **Schema tests**: every generated manifest validated against its official schema (SchemaStore: Claude Code plugin/marketplace, Codex plugin/hooks/skill-metadata; Agent Plugins spec repo schemas; Gemini checks hand-derived from the gemini-cli extensions reference — no published schema exists).
- **External-validator tests** (CI, where installable): `claude plugin validate --strict` against generated output.
- **Dogfood test**: import the superpowers repo, assert generated manifests are semantically equivalent (same JSON content, formatting-insensitive) to the real ones — manifest-only harnesses first, expanding adapter by adapter.

### Tests generated into plugin repos

`tests/everyharness/` with a runner re-validating layout + drift, plus an opt-out GitHub Actions workflow wiring `everyharness validate` into the plugin's CI.

## Generated docs

- `docs/install/<harness>.md` per-harness install instructions
- README install-matrix section injected between markers (author prose survives regeneration)
- `docs/support-matrix.md` — which components work where

## Error handling

Loud and specific. Config errors fail with YAML path and cause. Unsupported combinations warn with matrix references, never silently drop. Drift reports name each file and offer `--force` (regenerate) or moving hand-edits into `overrides`. Distinct exit codes for config error / drift / validation failure, for CI.

## Phasing

- **V1**: both repos; `init`, `import`, `generate`, `validate`, `matrix`; all adapters at researched depth; kitchen-sink fixture; full test suite; generated docs/tests/workflow. Container repo ships Dockerfile + GHCR publish workflow.
- **Phase 2**: `everyharness test` — runs the everyharness-container image, installs the generated plugin into each harness CLI, scripted smoke checks (plugin visible/loadable; where headless prompting exists, verify bootstrap injection). Credential mounting documented, following superpowers-evals' `/auth` conventions.
- **Later, separate tasks**: superpowers-evals consumes the container repo; superpowers migrates to generation; multi-plugin marketplace-repo generator.

## Prior art (researched 2026-08-10)

- **Agent Plugins 1.0** (agent-plugins.org, shipped 2026-08-06; Vercel-proposed, TSC incl. OpenAI/Microsoft/Cursor/AWS): standardizes root plugin.json + skills/ + mcp.json; excludes commands/agents/hooks/bootstrap; Anthropic and Google absent. Consumed as an output target, not the source format.
- **EveryInc/compound-engineering-plugin** (MIT): Claude→11-harness converter, closest coverage overlap (incl. Pi/Devin/Droid/Antigravity), but Bun-based and embedded ("not for normal installation"). Mine for per-harness knowledge; don't build on it.
- **wshobson/agents** (MIT): Makefile generators, useful reference for Gemini TOML and OpenCode/Copilot output shapes.
- **vercel-labs `npx plugins` / `npx skills`**: install-time translators; `skills` is skills-only with no bootstrap (already rejected in superpowers' CLAUDE.md); `plugins` covers 6 harnesses, source repo currently 404s.
- **Schemas/validators**: SchemaStore (Claude Code, Codex manifests), `claude plugin validate --strict`, Agent Plugins spec schemas.

## Source material

- `superpowers/docs/porting-to-a-new-harness.md` — invariants + per-harness index (Appendix A)
- `superpowers/.version-bump.json` — the 9-manifest version-wiring problem this tool subsumes
- `superpowers-evals/container/` — the Dockerfile to extract
- `superpowers/scripts/sync-to-codex-plugin.sh`, `package-codex-plugin.sh` — Codex distribution mechanics
