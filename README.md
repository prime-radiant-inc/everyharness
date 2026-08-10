# everyharness

Generate a coding-agent plugin for every harness from one config file.

One `everyharness.yaml` is the source of truth; `everyharness generate` emits
native plugin manifests, bootstrap wiring, docs, and tests for every supported
coding-agent harness (Claude Code, Codex, Gemini CLI, Cursor, Copilot CLI,
OpenCode, Pi, Kimi Code, Hermes, Devin CLI, Factory Droid, Grok Build CLI,
Antigravity). Generated files are committed; `everyharness validate` catches
drift in CI.

Status: under construction. Design: `docs/superpowers/specs/2026-08-10-everyharness-design.md`.

## License

MIT
