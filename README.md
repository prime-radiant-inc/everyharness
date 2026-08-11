# everyharness

> [!WARNING]
> **Work in progress — pre-alpha.** The v1 feature set is complete: eleven harness adapters, init/import, generated install docs, and container-backed install checks. Not yet published to npm; interfaces may still change. Everything — including the
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
npx everyharness test       # container-backed offline install checks (needs docker; exit 2 = failed checks)
```

`everyharness test` runs two offline tiers inside the container: first it parses every generated harness manifest and confirms referenced paths exist, then it performs a **real install** of the plugin into each harness CLI (claude, codex, gemini, opencode, grok, droid, hermes, copilot, pi) and asserts the CLI actually enumerates the plugin's skills — the check that catches a manifest that parses but is wired to the wrong place. Harnesses with no offline enumeration path (kimi, cursor, devin) are reported as `skip`. It pulls ghcr.io/prime-radiant-inc/everyharness-container on first use (large image, ~15GB, linux/amd64) — prefetch with `docker pull` if you want progress control.

**Current status: generation works via 11 adapters covering 13 harnesses; `init` scaffolds, `import` converts Claude-format plugins, every generation emits install docs + a support matrix, and `everyharness test` runs offline manifest checks plus real per-harness install + skill-enumeration checks for all harnesses inside the shared container image (ghcr.io/prime-radiant-inc/everyharness-container). The superpowers dogfood test regenerates superpowers' hand-maintained manifests (4 of 8 byte-exact, 4 with one documented difference each).**

Design: `docs/superpowers/specs/2026-08-10-everyharness-design.md`.

## License

MIT
