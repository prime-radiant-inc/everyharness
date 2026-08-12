# Respect User Hooks + Close All Dogfood Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A plugin that ships carefully hand-crafted hooks (superpowers) must be able to keep them: everyharness must not emit its own hook files or force manifest hook pointers over them. Together with a `deepMerge` delete sentinel and the (already-shipped) `marketplace.description`, this closes every documented dogfood difference: **the acceptance criterion is the superpowers dogfood test passing with an EMPTY `EXPECTED_DIFFERENCES` list — all eight manifests byte-for-byte.**

**Architecture:** (1) `deepMerge` treats an override value of `null` as "delete this key". (2) `bootstrap.emitHooks: false` extends the skill/generate bootstrap modes: the claude-code and cursor adapters skip their shell-hook tier (no `hooks/everyharness/` files, no forced manifest `hooks` pointer) and fall back to the plugin's own hook wiring; every other bootstrap surface (kimi sessionStart, gemini GEMINI.md, opencode/pi/hermes runtime injection, generate-mode content file) is unchanged. (3) The dogfood config exercises all three fixes and the exceptions list goes to zero.

**Tech Stack:** TypeScript/vitest only. No container work.

## Global Constraints

- All 391 existing tests stay green (except assertions this plan explicitly changes); TDD; no new deps; match surrounding style.
- Kitchen-sink keeps the default (`emitHooks` true) so the shell-hook tier stays exercised end-to-end.
- The findings doc `docs/superpowers/plans/2026-08-11-dogfood-findings.md` must be updated to record both findings as fixed (with commit references), not deleted — it is the historical record.
- `bootstrap.emitHooks` is only meaningful with `skill`/`generate`; setting it with `none` is a ConfigError (`bootstrap.emitHooks requires a skill or generate bootstrap`).
- Delete-sentinel semantics: in any `harnesses.overrides.<adapter>` object, a value of exactly `null` removes that key from the adapter's output instead of merging; nested objects apply the rule recursively. A `null` for a key the base doesn't have is a no-op (not an error). Document in README's overrides section.

---

### Task 1: `deepMerge` null delete-sentinel (dogfood Finding 2)

**Files:**
- Modify: `src/fileset.ts` (`deepMerge`, lines ~35-42)
- Modify: `README.md` (overrides documentation)
- Test: `tests/fileset.test.ts` (or wherever deepMerge's tests live — locate with `grep -rln deepMerge tests/`)

**Interfaces:** `deepMerge(base, override)` — unchanged signature. New behavior: `null` override values delete; applies at every nesting depth.

- [ ] **Step 1: Write failing tests**

```ts
expect(deepMerge({ a: 1, b: 2 }, { b: null })).toEqual({ a: 1 })
expect(deepMerge({ a: { x: 1, y: 2 } }, { a: { y: null } })).toEqual({ a: { x: 1 } })
expect(deepMerge({ a: 1 }, { b: null })).toEqual({ a: 1 })          // deleting a missing key: no-op
expect(deepMerge({ a: 1 }, { a: { b: null } })).toEqual({ a: {} })  // replace-then-delete inside a non-object base
// end-to-end: kimi override with repository: null drops the inherited field
// (build a model whose config has repository + overrides.kimi.repository: null,
// assert the emitted .kimi-plugin/plugin.json has no repository key and no null)
```

- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement**

```ts
for (const [key, value] of Object.entries(override)) {
  if (value === null) {
    delete out[key]
  } else {
    out[key] = key in out ? deepMerge(out[key], value) : value
  }
}
```

Update `deepMerge`'s doc comment (delete sentinel; a literal null can no longer be set via overrides — that trade-off is deliberate, note it). README: document `null` in overrides with the kimi `repository: null` example.

- [ ] **Step 4: Full `npm test` green**
- [ ] **Step 5: Commit** — `feat: overrides delete inherited keys via null sentinel`

---

### Task 2: `bootstrap.emitHooks: false` — keep the plugin's own hooks

**Files:**
- Modify: `src/config.ts` (`BootstrapMode` union at ~15-18, bootstrap zod object at ~65, `resolveBootstrap` at ~148)
- Modify: `src/adapters/claude-code.ts`, `src/adapters/cursor.ts` (gate shell-hook file emission + manifest `hooks` pointer + install-doc "What gets emitted" line on `emitHooks`)
- Test: `tests/config.test.ts`, the claude-code and cursor adapter tests

**Interfaces:**
```ts
export type BootstrapMode =
  | { kind: 'skill'; skill: string; emitHooks: boolean }
  | { kind: 'generate'; emitHooks: boolean }
  | { kind: 'none' }
// resolveBootstrap: emitHooks defaults to true; raw.emitHooks === false with kind 'none' -> ConfigError
```
YAML: `bootstrap: { skill: using-superpowers, emitHooks: false }`.

**Semantics (binding):** when `emitHooks` is false and bootstrap kind is skill/generate:
- claude-code and cursor emit NO `hooks/everyharness/*` files and do NOT set the manifest `hooks` key from the bootstrap path. The existing non-bootstrap fallback logic applies instead (claude-code: `hooks` set only when `model.hooks` exists at a non-default path; cursor: its existing equivalent — read it first). The plugin's own hand-written hooks (auto-discovered `hooks/hooks.json`, or whatever the user wires via `harnesses.overrides`) carry the bootstrap.
- The claude-code/cursor install docs drop their bootstrap-hook bullet (they no longer emit one) — if the doc mentions bootstrap at all in this mode, it should say bootstrap injection is handled by the plugin's own hooks.
- EVERYTHING else is unchanged: kimi `sessionStart.skill`, gemini GEMINI.md @-include, opencode/pi/hermes runtime injection, and — critically — `bootstrap.generate` mode still writes the generated bootstrap content file (runtime adapters read it at load; trace `GENERATED_BOOTSTRAP_PATH` consumers before gating anything).
- A `<plugin-bootstrap>` wrapper/marker behavior elsewhere is untouched.

- [ ] **Step 1: Write failing tests**

```ts
// config: default true
expect(loadConfig(rootWith({ bootstrap: { skill: 'x' } })).bootstrap).toEqual({ kind: 'skill', skill: 'x', emitHooks: true })
// config: explicit false
expect(loadConfig(rootWith({ bootstrap: { skill: 'x', emitHooks: false } })).bootstrap.emitHooks).toBe(false)
// config: emitHooks with none -> ConfigError
expect(() => loadConfig(rootWith({ bootstrap: { none: true, emitHooks: false } }))).toThrow(/emitHooks/)
// claude-code, emitHooks false: no hooks/everyharness files, no manifest hooks key (default components)
const files = claudeCode.emit(modelWith({ bootstrap: { kind: 'skill', skill: 'x', emitHooks: false } })).files
expect(files.map((f) => f.path).filter((p) => p.startsWith('hooks/'))).toEqual([])
expect(JSON.parse(manifestFile.content)).not.toHaveProperty('hooks')
// cursor: same shape
// claude-code, emitHooks true (default): existing behavior byte-identical (existing tests keep passing untouched)
```

- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement** (schema + both adapters + install-doc gating)
- [ ] **Step 4: Full `npm test` green (existing kitchen-sink snapshots unchanged — default is true)**
- [ ] **Step 5: Commit** — `feat: bootstrap.emitHooks=false keeps the plugin's hand-crafted hooks`

---

### Task 3: Dogfood goes to 8/8 byte-exact; findings recorded as fixed

**Files:**
- Modify: `tests/dogfood.test.ts` (`buildConfig()`, `EXPECTED_DIFFERENCES`, the byte-exact assertion split)
- Modify: `docs/superpowers/plans/2026-08-11-dogfood-findings.md` (mark both findings FIXED with commit refs and the mechanisms)
- Modify: `README.md` if it states the 4/8 dogfood number anywhere (correct to 8/8)

**Requirements:**

1. `buildConfig()` changes:
   - `bootstrap: { skill: <current value>, emitHooks: false }` — superpowers hand-wires its hooks.
   - `marketplace: { description: 'Development marketplace for Superpowers core skills library' }` (plus any existing marketplace keys) — closes Finding 1 via the #7 config.
   - kimi override gains `repository: null` — closes Finding 2 via Task 1's sentinel.
   - cursor: superpowers' real `.cursor-plugin/plugin.json` points `hooks` at `./hooks/hooks-cursor.json`; with `emitHooks: false` the adapter no longer forces its own pointer, so express the real value through the existing override channel (`overrides.cursor.hooks: './hooks/hooks-cursor.json'`) or the components mapping — whichever the adapter's non-bootstrap logic makes natural; read the adapter first and pick the one that needs no new machinery.
2. `EXPECTED_DIFFERENCES` becomes an empty array. Do not delete the machinery (`stripDifferences` etc.) — leave it in place with the empty list so future differences have somewhere to go; the derived "byte-exact vs modulo-differences" test split should now put ALL EIGHT files in the byte-for-byte group.
3. Every one of the eight dogfood files asserts `readFileSync(generated) === readFileSync(original)` byte-for-byte. If ANY file cannot reach byte-exactness with the three mechanisms above, STOP and report BLOCKED with the exact diff — do not add a new EXPECTED_DIFFERENCES entry on your own authority.
4. Findings doc: append a "Resolution (2026-08-12)" section to each finding recording the fix mechanism (Finding 1: `marketplace.description` from issue #7 + dogfood config update; Finding 2: null delete-sentinel) and this branch's commits. Do not rewrite the historical analysis.

- [ ] **Step 1: Update buildConfig + empty the exceptions list (this IS the failing-test step — run the dogfood test and watch which files still differ; iterate config only within the mechanisms above)**
- [ ] **Step 2: All eight byte-exact; full `npm test` green**
- [ ] **Step 3: Update findings doc + any README claim**
- [ ] **Step 4: Commit** — `test: superpowers dogfood regenerates all eight manifests byte-for-byte`

---

### Task 4 (added after Task 3's BLOCKED escalation): claude-code key order matches the canonical hand-written files

Task 3 exposed a third gap once the masks came off: `src/adapters/claude-code.ts` emits
`.claude-plugin/plugin.json` keys as `name, version, description, author, license,
repository, homepage, keywords` and `.claude-plugin/marketplace.json` as
`name, description, plugins, owner`; superpowers' real files use
`name, description, version, author, homepage, repository, license, keywords` and
`name, description, owner, plugins`. deepMerge never reorders, so no config can fix it.

**Scope (binding):** reorder ONLY the claude-code adapter's own object construction —
`pluginManifest()`'s literal/append order and `marketplaceManifest()`'s (`owner` before
`plugins`). Do NOT touch `baseManifestFields()` or any other adapter: cursor, codex,
devin, and kimi are already byte-exact with the current shared order and must stay so.
Kitchen-sink snapshot updates for the two claude-code files are expected; every other
snapshot entry must be byte-identical. JSON key order is semantically meaningless, so
this is cosmetic for consumers; the dogfood byte-exact goal makes the hand-written
files the canonical order.

- [ ] Reorder, with a comment naming the canonical source (superpowers' hand-written manifests)
- [ ] Snapshot updates limited to the two claude-code entries
- [ ] Full `npm test` green; then complete Task 3 (all eight byte-exact, findings doc, README)
- [ ] Commit — `fix: claude-code manifest key order matches the canonical hand-written files`
