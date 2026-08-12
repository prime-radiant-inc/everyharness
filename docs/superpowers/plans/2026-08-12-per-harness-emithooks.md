# Per-Harness emitHooks + Semantic Dogfood Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two design corrections from Jesse: (1) `bootstrap.emitHooks` must be configurable per harness, not only globally; (2) JSON key order is explicitly NOT a goal — the dogfood test should assert semantic JSON equality, and the claude-code key reorder (which existed only to satisfy byte-exactness) should be reverted.

**Architecture:** `emitHooks` becomes `boolean | Record<string, boolean>` in config, resolved through the existing single choke point `bootstrapEmitsHooks(bootstrap)` in `src/adapters/shared.ts`, which gains a harness-name parameter. The dogfood test's per-file assertion switches from byte comparison to parsed-JSON deep equality (all eight files are JSON), and claude-code's manifest construction goes back to the shared field order.

**Tech Stack:** TypeScript/vitest only.

## Global Constraints

- All 416 existing tests stay green except assertions this plan explicitly changes; TDD; no new deps; match style.
- `emitHooks` semantics (binding):
  - `emitHooks: false` / `true` (boolean) — applies to every hook-emitting harness (today: claude-code, cursor). Existing behavior preserved exactly.
  - `emitHooks: { claude-code: false }` (map) — per-harness; any harness not named defaults to `true`.
  - Map keys must be members of the set of hook-emitting harnesses (`claude-code`, `cursor`); an unknown key is a ConfigError naming the key and the valid set (catches typos like `claudecode`).
  - Any `emitHooks` (boolean or map) with `bootstrap: none` remains a ConfigError (existing rule).
- Key order: NOT a goal, per Jesse. No adapter should carry key-order special-casing justified only by matching a hand-written file.
- The dogfood acceptance criterion is now: all eight manifests **semantically identical** (parsed-JSON deep equality) with `EXPECTED_DIFFERENCES = []`. Formatting and key order are explicitly out of scope, and the test header must say so.
- Findings doc: append a note to Finding 3's Resolution recording Jesse's ruling (key order out of scope; reorder reverted; dogfood compares semantically). Do not rewrite history above it.

---

### Task 1: `emitHooks: boolean | per-harness map`

**Files:**
- Modify: `src/config.ts` (BootstrapMode at lines 15-18, zod `emitHooks` at ~70, resolveBootstrap at ~148-167)
- Modify: `src/adapters/shared.ts` (`bootstrapEmitsHooks` at ~34), `src/adapters/claude-code.ts` (4 call sites: lines 54, 113, 170 + import), `src/adapters/cursor.ts` (call sites: 31, 51, 105 + import)
- Modify: `README.md` (emitHooks docs gain the map form)
- Test: `tests/config.test.ts`, claude-code and cursor adapter tests

**Interfaces (binding):**
```ts
// config.ts
export const HOOK_EMITTING_HARNESSES = ['claude-code', 'cursor'] as const
export type BootstrapMode =
  | { kind: 'skill'; skill: string; emitHooks: Record<string, boolean> }
  | { kind: 'generate'; emitHooks: Record<string, boolean> }
  | { kind: 'none' }
// resolveBootstrap normalizes: absent -> {} ; boolean b -> { 'claude-code': b, cursor: b } ;
// map -> validated map (unknown key -> ConfigError). Record semantics: missing key = true.

// shared.ts
export function bootstrapEmitsHooks(bootstrap: EveryharnessConfig['bootstrap'], harness: string): boolean
// none -> false (as today); skill/generate -> bootstrap.emitHooks[harness] ?? true
```
YAML forms: `emitHooks: false` and `emitHooks: { claude-code: false }`.

- [ ] **Step 1: Write failing tests**

```ts
// boolean forms still normalize (existing tests updated to the Record shape)
expect(loadConfig(rootWith({ bootstrap: { skill: 'x', emitHooks: false } })).bootstrap.emitHooks)
  .toEqual({ 'claude-code': false, cursor: false })
// map form, unnamed harness defaults true
const b = loadConfig(rootWith({ bootstrap: { skill: 'x', emitHooks: { 'claude-code': false } } })).bootstrap
expect(b.emitHooks).toEqual({ 'claude-code': false })
// unknown key -> ConfigError naming key and valid set
expect(() => loadConfig(rootWith({ bootstrap: { skill: 'x', emitHooks: { claudecode: false } } })))
  .toThrow(/claudecode.*claude-code.*cursor/s)
// map with none -> ConfigError (existing rule extended)
expect(() => loadConfig(rootWith({ bootstrap: { none: true, emitHooks: { cursor: false } } }))).toThrow(/emitHooks/)
// MIXED adapter behavior — the point of the feature:
// config: bootstrap { skill: 'x', emitHooks: { 'claude-code': false } }
// claude-code: zero hooks/ files, no manifest hooks key
// cursor: its bootstrap hook files present AND manifest hooks pointer set (default true applies)
```

- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement** (zod: `z.union([z.boolean(), z.record(z.string(), z.boolean())])`; validate map keys against HOOK_EMITTING_HARNESSES in resolveBootstrap; adapters pass their own name — use each adapter's existing `name` constant, not a new string literal, where practical)
- [ ] **Step 4: Full `npm test` green; kitchen-sink snapshots unchanged (default unchanged); dogfood unchanged (its `emitHooks: false` boolean form still means both)**
- [ ] **Step 5: Commit** — `feat: emitHooks is configurable per harness`

---

### Task 2: Key order out of scope — revert reorder, dogfood compares semantically

**Files:**
- Modify: `src/adapters/claude-code.ts` (`pluginManifest` field order back to the shared base order `name, version, description, author, license, repository, homepage, keywords`; `marketplaceManifest` back to `owner` after `plugins`; remove the canonical-order comments)
- Modify: `tests/dogfood.test.ts` (byte-for-byte assertions → parsed-JSON `toEqual`; header documents that formatting/key order are explicitly not compared, per Jesse's ruling; also state the floating-dev-branch tripwire is deliberate — closes the recorded Minor)
- Modify: `docs/superpowers/plans/2026-08-11-dogfood-findings.md` (append the ruling note to Finding 3's Resolution)
- Modify: `README.md` (dogfood claim: "all eight manifests semantically identical (JSON key order and formatting are explicitly not compared)")
- Test: kitchen-sink snapshots revert to the pre-reorder claude-code entries

**Requirements:**
1. The revert restores claude-code to exactly the order `baseManifestFields` produces (same as cursor/codex/devin/kimi) — diff the two claude-code snapshot entries against their state at commit 58bd63a (`git show 58bd63a:tests/__snapshots__/generate.test.ts.snap`) to confirm the revert is exact.
2. Dogfood: every per-file test parses BOTH sides with JSON.parse and asserts deep equality (`toEqual`). The stripDifferences machinery keeps working on parsed objects (it already operates on objects — verify). `EXPECTED_DIFFERENCES` stays `[]`. All eight files must still pass — semantic equality held even before the reorder (the reorder only fixed byte order), so this must be green with the revert in place; if any file is NOT semantically equal, STOP and report BLOCKED with the diff.
3. Raw byte comparison is removed entirely from the test (no dead code path kept "just in case").

- [ ] **Step 1: Switch dogfood assertions to semantic (red step: they pass — then revert the adapter order and confirm they STILL pass while the old byte assertions would have failed; state this verification in the report)**
- [ ] **Step 2: Revert adapter order + snapshots; full `npm test` green**
- [ ] **Step 3: Findings doc + README + test-header notes**
- [ ] **Step 4: Commit** — `revert: claude-code key reorder; dogfood asserts semantic JSON equality (key order is not a goal)`
