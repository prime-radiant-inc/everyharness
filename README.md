# everyharness

> [!WARNING]
> **Work in progress — pre-alpha.** Eleven harness adapters exist today (see Current status below); init/import, generated install docs, the superpowers dogfood test, and container-based install testing are still being built. Not yet published to npm. Everything — including the
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
npx everyharness generate   # emit per-harness files from everyharness.yaml
npx everyharness validate   # drift + schema checks (exit 3 = drift, 2 = schema)
npx everyharness matrix     # component-support matrix
```

**Current status: generation works for all 12+ target harnesses — Claude Code, Cursor, Codex, Devin, Kimi, Gemini (incl. TOML commands), OpenCode (incl. commands/agents), Pi, Hermes, Agent Plugins 1.0, and the .agents marketplace descriptor (Droid/Grok/Copilot). Remaining before v1: init/import, generated install docs, superpowers dogfood test, container-based install testing.**

Design: `docs/superpowers/specs/2026-08-10-everyharness-design.md`.

## License

MIT
