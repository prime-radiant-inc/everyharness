# everyharness

> [!WARNING]
> **Work in progress — pre-alpha.** Only the core pipeline and the Claude Code
> adapter exist today. The other harness adapters, `init`/`import`, generated
> install docs, and container-based install testing are still being built.
> Not yet published to npm. Everything — including the `everyharness.yaml`
> schema and the generation-manifest format — may change without notice.
> Don't depend on this yet.

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

**Current status: generation works for Claude Code, Cursor, Codex, Devin, Kimi, Gemini, Agent Plugins 1.0, and the .agents marketplace descriptor (Droid/Grok/Copilot). Bootstrap injection: Claude Code, Cursor, Copilot, Antigravity (shell hook), Kimi (manifest-native), Gemini (context file). OpenCode, Pi, and Hermes land in Plan 3.**

Design: `docs/superpowers/specs/2026-08-10-everyharness-design.md`.

## License

MIT
