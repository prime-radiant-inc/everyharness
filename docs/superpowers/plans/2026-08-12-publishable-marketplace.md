# Publishable Marketplace Implementation Plan (issue #7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `everyharness.yaml` describe a real, publishable claude-code marketplace (name, description, source, strict) instead of only the hardcoded `<name>-dev` / `source: "./"` dev descriptor, per issue #7's suggested fix.

**Architecture:** Widen the existing `marketplace` config key (zod schema + `EveryharnessConfig`), consume the new fields in the claude-code adapter's `marketplaceManifest` and `installDoc`, and generalize the deep-check tier's `MARKET` derivation so it reads the emitted descriptor instead of assuming `-dev`.

**Tech Stack:** TypeScript (zod, vitest), bash (checks), docker (live verification).

## Global Constraints

- All existing tests stay green (`npm test`, currently 327). TDD for every change.
- No new dependencies. Match surrounding code style.
- Scope is the claude-code marketplace ONLY. The `.agents/plugins/marketplace.json` descriptor (agents-marketplace adapter) keeps its `-dev` name and is NOT touched — issue #7 is about `.claude-plugin/marketplace.json`, and the droid/copilot/grok flows were verified against the current descriptor.
- Defaults preserve today's output byte-for-byte: a config without the new fields must emit exactly the current dev marketplace (name `<name>-dev`, description `Development marketplace for <name>`, entry source `"./"`, no `strict`). The existing kitchen-sink/dogfood snapshots must not change except where a task explicitly says so.
- Checks conventions: `set -u` not `-e`; TAP-ish `ok`/`not ok`/`skip`; exit 3 on failure; CLI absent → skip; fully offline; never write into the mounted plugin dir.
- New config fields (exact semantics from issue #7):
  - `marketplace.name` (string, optional) — marketplace name; default `<name>-dev`.
  - `marketplace.description` (string, optional) — default `Development marketplace for <name>`.
  - `marketplace.source` (optional) — `"local"` (default) → entry `source: "./"`; `"repository"` → entry `source: { source: "url", url: config.repository }`; an explicit `http(s)://` URL string → entry `source: { source: "url", url: <value> }`.
  - `marketplace.strict` (boolean, optional) — emitted on the plugin entry only when present.
  - `category`/`tags` keep their existing behavior (entry `category` / `keywords`).
- `source: "repository"` with no `config.repository` is a ConfigError at load time, with a message naming both fields.

---

### Task 1: Config schema for the widened `marketplace` key

**Files:**
- Modify: `src/config.ts` (marketplace schema at lines 82–84, `EveryharnessConfig.marketplace` type at line 99)
- Test: the existing config test file (locate via `grep -rln "marketplace" tests/` — extend where the current category/tags cases live)

**Interfaces:**
- Produces (later tasks rely on these exact shapes):
  ```ts
  marketplace?: {
    name?: string
    description?: string
    source?: 'local' | 'repository' | string  // string form is an http(s) URL
    category?: string
    tags?: string[]
    strict?: boolean
  }
  ```
- `loadConfig` throws `ConfigError` when `marketplace.source === 'repository'` and `repository` is absent.

- [ ] **Step 1: Write failing tests**

```ts
// accepts the widened key
const cfg = loadConfig(rootWith({ marketplace: { name: 'pub', description: 'D', source: 'repository', strict: false, category: 'c', tags: ['t'] }, repository: 'https://github.com/o/r' }))
expect(cfg.marketplace).toEqual({ name: 'pub', description: 'D', source: 'repository', strict: false, category: 'c', tags: ['t'] })

// explicit URL source accepted
loadConfig(rootWith({ marketplace: { source: 'https://github.com/o/r.git' } }))  // no throw

// repository source without repository -> ConfigError naming both fields
expect(() => loadConfig(rootWith({ marketplace: { source: 'repository' } })))
  .toThrow(/marketplace\.source.*repository/)

// junk source rejected
expect(() => loadConfig(rootWith({ marketplace: { source: 'ftp://x' } }))).toThrow()
```

(Adapt `rootWith` to however the config tests build fixture roots today — reuse their helpers.)

- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement**

```ts
marketplace: z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    source: z
      .union([z.literal('local'), z.literal('repository'), z.string().regex(/^https?:\/\//, 'must be "local", "repository", or an http(s) URL')])
      .optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    strict: z.boolean().optional(),
  })
  .optional(),
```

Add the cross-field rule where loadConfig already surfaces schema errors (superRefine on the root schema, or an explicit post-parse check matching how other cross-field rules are done — inspect first): `marketplace.source === 'repository'` requires `repository`, error message naming `marketplace.source: repository` and the missing `repository` key. Update the `EveryharnessConfig` interface to match.

- [ ] **Step 4: Tests pass; full `npm test` green**
- [ ] **Step 5: Commit** — `feat: widen marketplace config for publishable descriptors (#7)`

---

### Task 2: claude-code adapter consumes the new fields

**Files:**
- Modify: `src/adapters/claude-code.ts` (`marketplaceManifest` lines 66–84, ground-truth comment lines 86–89, `installDoc` install line ~116)
- Test: the claude-code adapter test file; affected snapshots

**Interfaces:**
- Consumes: `config.marketplace` per Task 1's shape.
- Produces: `.claude-plugin/marketplace.json` honoring the fields; install doc `/plugin install <name>@<marketplace-name>`.

- [ ] **Step 1: Write failing tests**

```ts
// publishable descriptor (name, description, repository source, strict)
// config: name 'proving-it-works', repository 'https://github.com/o/proving-it-works.git',
// marketplace: { name: 'proving-it-works', description: 'Real desc', source: 'repository', strict: false }
expect(mk.name).toBe('proving-it-works')
expect(mk.description).toBe('Real desc')
expect(mk.plugins[0].source).toEqual({ source: 'url', url: 'https://github.com/o/proving-it-works.git' })
expect(mk.plugins[0].strict).toBe(false)

// explicit URL source
// marketplace: { source: 'https://example.com/repo.git' }
expect(mk.plugins[0].source).toEqual({ source: 'url', url: 'https://example.com/repo.git' })

// defaults unchanged (no marketplace key): name `<name>-dev`, description `Development marketplace for <name>`, source './' , no strict key
expect(mk.plugins[0]).not.toHaveProperty('strict')

// install doc uses the marketplace name
expect(doc).toContain('/plugin install proving-it-works@proving-it-works')
```

- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement**

In `marketplaceManifest`: resolve `const mkName = config.marketplace?.name ?? `${config.name}-dev``, `const mkDescription = config.marketplace?.description ?? `Development marketplace for ${config.name}``, and entry source per the Global Constraints mapping (`'repository'` reads `config.repository` — Task 1 guarantees it exists). Emit `entry.strict` only when `config.marketplace?.strict !== undefined`. In `installDoc`: install line becomes `` `/plugin install ${config.name}@${mkName}` `` (extract the same resolution — one small shared helper inside the file is fine; do not duplicate the default expression twice). Update the ground-truth comment (lines 86–89) to describe the marketplace-name derivation instead of hardcoded `-dev`.

- [ ] **Step 4: Tests pass; update any legitimately-changed snapshots (defaults must NOT change any); full `npm test` green**
- [ ] **Step 5: Commit** — `feat: claude-code marketplace honors name/description/source/strict (#7)`

---

### Task 3: Deep checks read the real marketplace name; fixture + docs; live verification

**Files:**
- Modify: `checks/run-checks.sh` (`MARKET="${PLUGIN_NAME}-dev"` at line ~497)
- Modify: `fixtures/kitchen-sink/everyharness.yaml` (marketplace block at lines 17–19)
- Modify: whichever doc documents the `marketplace` config key (locate via `grep -rn "category" README.md docs/ --include="*.md" | grep -iv superpowers`; if none documents it, add the new fields where the config keys are documented in README)
- Test: existing checks-script tests; regenerated kitchen-sink snapshots

**Interfaces:**
- Consumes: the emitted `.claude-plugin/marketplace.json` (Task 2).

**Requirements:**

1. `MARKET` derivation: read `.name` from `$PLUGIN_ROOT/.claude-plugin/marketplace.json` via jq, falling back to `${PLUGIN_NAME}-dev` when the file is absent/unparseable. Comment why (the descriptor's declared name is what claude/codex/copilot install ids use, and it is now configurable).
2. Offline guard: if the descriptor's entry source is not the local `"./"` (jq: `.plugins[0].source != "./"` — object sources count as non-local), the claude-code, codex, and copilot install checks must `skip` with reason `marketplace entry source is not local; offline install check needs source "./"` instead of attempting a network clone. Other harnesses are unaffected (they don't install through this descriptor).
3. Kitchen-sink exercises the naming path without breaking offline installs: add `name: kitchen-sink-market` (keep `source` at its local default; keep category/tags) to the fixture's marketplace block. Regenerate fixture outputs/snapshots; the emitted marketplace name and the claude-code install doc line must show `kitchen-sink-market`.
4. Docs: document all new `marketplace` fields (name/description/source/strict with defaults and the repository-requires-repository rule) wherever the config keys are documented.

- [ ] **Step 1: Write failing tests** — extend the checks-script tests minimally: with PATH sandboxed (no harness CLIs) everything still skips and exits 0 against the regenerated kitchen-sink copy (this catches jq/bash errors in the new derivation since `deep_checks` still runs its setup); plus a unit-level bash test in the same style as the existing `oneline()` test that runs the MARKET-derivation snippet against a temp dir containing a marketplace.json with a custom name and asserts the derived value (and the `-dev` fallback when the file is missing).
- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement** the derivation + offline guard; update fixture; regenerate; update docs
- [ ] **Step 4: All tests green (`npm test`)**
- [ ] **Step 5: Live verification (required):** run the built CLI's `test` command against the regenerated kitchen-sink fixture with the real `ghcr.io/prime-radiant-inc/everyharness-container:latest` image. The claude-code/codex/copilot install checks must pass using the `kitchen-sink-market` name (proving the derivation end-to-end). Paste the TAP output in your report.
- [ ] **Step 6: Commit** — `feat: deep checks derive the marketplace name from the emitted descriptor (#7)`
