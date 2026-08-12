# validate Loads the Config Implementation Plan (issue #10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `everyharness validate` must refuse a config `generate` refuses: it calls `loadConfig` first and reports ConfigErrors exactly the way `generate` does, exiting 1 — config errors outrank drift.

**Architecture:** One change in `src/validate.ts`: `loadConfig(root)` at the top of `validate()`, before `checkDrift`. A thrown ConfigError propagates to cli.ts's existing global mapping (exit 1), which is precisely `generate`'s behavior — verify no catch inside validate/cli's validate action swallows it.

**Tech Stack:** TypeScript/vitest.

## Global Constraints

- All 424 tests stay green; TDD; no new deps.
- Config errors outrank drift AND schema checks: a bad config must exit 1 with the pointed message even when drift/schema problems also exist — implemented naturally by loading first and letting the throw propagate.
- The user-visible error output for `validate` on a v1 config must be identical in content to `generate`'s (same ConfigError message path through cli.ts).
- README: if the validate/CI-gate paragraph or exit-code table needs a word (validate can now actually return 1), update it truthfully.

### Task 1: loadConfig at the top of validate

**Files:**
- Modify: `src/validate.ts` (import loadConfig; call at top of `validate()`, ~line 29)
- Modify: `README.md` only if the exit-code/CI wording needs it (inspect)
- Test: `tests/validate.test.ts` (locate actual name via `grep -rln "validate(" tests/ | grep -i valid`), `tests/cli.test.ts` for the exit-code path

**Interfaces:** `validate(root)` signature unchanged; throws ConfigError before producing a ValidateResult when the config is unloadable.

- [ ] **Step 1: Write failing tests**

```ts
// unit: a root whose everyharness.yaml uses v1 syntax (bootstrap: { generate: true })
// with committed generated files + manifest from a prior version:
expect(() => validate(root)).toThrow(ConfigError)
expect(() => validate(root)).toThrow(/bootstrap is now a tagged value/)
// config error outranks drift: same root ALSO given a deliberately drifted generated file
// -> still the ConfigError, not a drift report
// cli: spawn built cli `validate --dir <v1-root>` -> exit 1, stderr contains the pointed message
// cli: healthy root still exits 0 "validate: clean"
```

Build the v1-config fixture root by generating a valid v2 root first (or copying kitchen-sink output) and then rewriting everyharness.yaml to v1 syntax — the committed files and manifest stay valid, reproducing the issue's exact scenario (clean drift + broken config).

- [ ] **Step 2: Run to verify fail** (validate currently returns clean on that root)
- [ ] **Step 3: Implement** — import `loadConfig` in validate.ts, call it first with a comment citing issue #10 (validate is the CI gate; a config generate refuses must not pass). Check cli.ts's validate action and global error handling: ConfigError must reach the same exit-1 path generate uses (inspect; adjust only if something swallows it).
- [ ] **Step 4: Full `npm test` green; README exit-code/CI wording checked**
- [ ] **Step 5: Commit** — `fix: validate loads the config first, refusing what generate refuses (#10)`
