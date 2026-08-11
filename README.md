# everyharness

> [!WARNING]
> **Work in progress — pre-alpha.** Eleven harness adapters, init/import, and generated install docs exist today; container-based install testing is still being built. Not yet published to npm. Everything — including the
> `everyharness.yaml` schema and the generation-manifest format — may change
> without notice. Don't depend on this yet.

Generate a coding-agent plugin for every harness from one config file.

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
npx everyharness validate   # drift + schema checks (exit 3 = drift, 2 = schema)
npx everyharness matrix     # component-support matrix
```

**Current status: generation works via 11 adapters covering 13 harnesses; `init` scaffolds new plugins, `import` converts existing Claude-format plugins, and every generation emits per-harness install docs plus a support-matrix doc. The superpowers dogfood test regenerates superpowers' hand-maintained manifests (4 of 8 byte-exact, 4 with one documented difference each). Remaining before v1: container-based install testing (Plan 5).**

Design: `docs/superpowers/specs/2026-08-10-everyharness-design.md`.

## License

MIT
