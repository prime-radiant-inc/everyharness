# Dogfood expressiveness findings (Plan 5+ backlog)

**Source:** Plan 4 Task 6, the superpowers dogfood test
(`tests/dogfood.test.ts`). Design decision 7 required the test to fail on
any undocumented difference between everyharness's generated manifests and
superpowers' real hand-maintained ones; the `EXPECTED_DIFFERENCES` map in
that file documents every difference the test tolerates, each with a one-line
reason. Two of those four entries are genuine everyharness expressiveness
gaps rather than intentional design (marked `FINDING` in the map). This doc
records both in full, per Task 6's process rule ("report, not fix"; the
controller decides). Neither is fixed in Plan 4. Both are backlog for Plan 5
or later.

## Finding 1: `marketplaceManifest()` has no override hook

**Where:** `src/adapters/claude-code.ts`, `marketplaceManifest()`
(lines 66-84).

**Evidence:** `pluginManifest()` (same file, lines 27-64) ends with:

```ts
const override = config.harnesses.overrides['claude-code']
return override ? (deepMerge(manifest, override) as Record<string, unknown>) : manifest
```

`marketplaceManifest()` has no equivalent. Its description field is
hardcoded:

```ts
const marketplace: Record<string, unknown> = {
  name: `${config.name}-dev`,
  description: `Development marketplace for ${config.name}`,
  plugins: [entry],
}
```

superpowers' real `.claude-plugin/marketplace.json` has
`description: "Development marketplace for Superpowers core skills library"`
— a hand-written value that doesn't match the `Development marketplace for
${config.name}` template. There is no config path that reproduces it;
`harnesses.overrides['claude-code']` only ever reaches `pluginManifest()`.
This is `EXPECTED_DIFFERENCES`'s `.claude-plugin/marketplace.json` /
`description` entry in `tests/dogfood.test.ts`.

**Impact:** any plugin that wants marketplace-listing copy to differ from
its plugin.json description (a common real case — the marketplace blurb is
often longer/more promotional than the plugin's own description) cannot
express that through `everyharness.yaml`. Same gap applies to `name`,
`plugins[].category`/`keywords` on the marketplace entry, and `owner`,
though only `description` shows up as an actual difference against
superpowers today.

**Suggested fix shape (not a spec, needs its own design pass):**
Give `marketplaceManifest()` an override hook, but not by reusing
`harnesses.overrides['claude-code']` wholesale — that object's keys already
mean "override this key of plugin.json"; `description` there currently
drives both plugin.json and (if wired in naively) marketplace.json,
which is the wrong default for the common case where they're meant to
differ. A dedicated nested channel avoids the collision, e.g.:

```yaml
harnesses:
  overrides:
    claude-code:
      description: "...plugin.json description..."
      marketplace:
        description: "...marketplace.json description..."
```

`marketplaceManifest()` would deep-merge `override?.marketplace` (if
present) onto its own output, the same way `pluginManifest()` deep-merges
the rest of the override object today (and would need to delete/ignore the
`marketplace` key before merging the remainder onto `pluginManifest()`'s
output, so it doesn't leak into plugin.json). Needs a schema change
(`components`-adjacent `marketplace` key inside the per-harness override
record) and a test fixture update; ~15-25 LOC in `claude-code.ts` plus a
`config.ts` schema tweak.

### Resolution (2026-08-12)

Fixed, via a narrower mechanism than the "suggested fix shape" above:
`marketplaceManifest()` didn't need a whole new `overrides.claude-code.marketplace`
channel, just a config-level value for the one field that actually differs
in practice. Issue #7 (commit `71db3d7`, "feat: claude-code marketplace
honors name/description/source/strict (#7)") added top-level
`marketplace.description` to `config.ts`'s schema and wired it into
`marketplaceManifest()`:
`description: config.marketplace?.description ?? \`Development marketplace
for ${config.name}\``. This branch's dogfood config update
(`tests/dogfood.test.ts`'s `buildConfig()`, commit
`test: superpowers dogfood regenerates all eight manifests byte-for-byte`)
sets `marketplace: { description: <superpowers' real marketplace.json
description> }`, closing the gap this finding reported and removing the
`.claude-plugin/marketplace.json` / `description` `EXPECTED_DIFFERENCES`
entry. (`.claude-plugin/marketplace.json` needed a second, unrelated fix —
key order — before it reached byte-exactness; see Finding 3.)

## Finding 2: `deepMerge` cannot delete inherited fields (kimi `repository` leak)

**Where:** `src/fileset.ts`, `deepMerge()` (lines 35-42); consumed by every
adapter's `pluginManifest()`-equivalent, e.g. `src/adapters/kimi.ts` lines
44-52.

**Evidence:** `deepMerge`'s full body:

```ts
export function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in out ? deepMerge(out[key], value) : value
  }
  return out
}
```

Every key present in `override` is set (or recursively merged); there is no
way for an override to remove a key `base` already has. `kimi.ts`'s
`pluginManifest()` starts from `baseManifestFields(config)`
(`src/adapters/shared.ts`), which includes `repository` whenever
`config.repository` is set — and in the dogfood config it is, since
claude-code/codex/devin/cursor all inherit and match it. superpowers' real
`.kimi-plugin/plugin.json` has no `repository` key at all (Kimi's manifest
format doesn't carry it), but everyharness's kimi override in
`tests/dogfood.test.ts`'s `buildConfig()` has no way to suppress the
inherited field:

```ts
// kimi: its own (shorter) description, codex's keyword set, its
// tool-mapping skillInstructions, and its own (smaller) interface
// block. Deliberately has no `repository` override -- see the
// EXPECTED_DIFFERENCES entry for why that field still leaks through.
kimi: {
  description: kimi.description,
  keywords: kimi.keywords,
  skillInstructions: kimi.skillInstructions,
  interface: kimi.interface,
},
```

This is `EXPECTED_DIFFERENCES`'s `.kimi-plugin/plugin.json` / `repository`
entry.

**Impact:** any per-harness override that needs to *remove* a top-level
field (not just replace it) can't. `repository` is the concrete case here,
but the same limitation applies to `author`, `license`, `keywords`, or any
other `baseManifestFields` key a given harness's real manifest format omits.

**Suggested fix shape (not a spec, needs its own design pass):** adopt a
delete sentinel in `deepMerge`, e.g. treat an override value of `null` as
"delete this key from the output" rather than "set the key to `null`" (the
latter is what happens today — `deepMerge(x, null)` returns `null` since
`isPlainObject(null)` is false, so the key would round-trip into the
generated JSON as `"repository": null`, not disappear). Concretely:

```ts
for (const [key, value] of Object.entries(override)) {
  if (value === null) {
    delete out[key]
    continue
  }
  out[key] = key in out ? deepMerge(out[key], value) : value
}
```

This needs: (a) confirming no existing adapter ever legitimately wants a
`null` value in generated output (a quick grep across schemas/adapters
suggests no — JSON manifest fields are all strings/objects/arrays), (b) a
`config.ts` schema tweak to allow `null` in the
`harnesses.overrides.<harness>.<key>` record (currently
`z.record(z.string(), z.record(z.string(), z.unknown()))`, which already
permits `unknown` values including `null`, so likely no schema change
needed — just the `deepMerge` behavior change), and (c) updating the
dogfood config to add `kimi: { repository: null, ... }` and removing the
`EXPECTED_DIFFERENCES` entry once fixed. ~5 LOC in `fileset.ts`.

### Resolution (2026-08-12)

Fixed exactly as suggested above. Commit `f1b06bc` ("feat: overrides delete
inherited keys via null sentinel") added the delete-sentinel to
`deepMerge()`: an override value of exactly `null` now deletes the key from
`out` instead of merging, recursively at every nesting depth (a `null` for a
key the base doesn't have is a no-op). This branch's dogfood config update
(`tests/dogfood.test.ts`'s `buildConfig()`) added `repository: null` to the
kimi override, and the `.kimi-plugin/plugin.json` / `repository`
`EXPECTED_DIFFERENCES` entry was removed. `.kimi-plugin/plugin.json` reaches
byte-exactness with this fix alone.

## Finding 3: claude-code's hardcoded field order didn't match superpowers' real files

**Where:** `src/adapters/claude-code.ts`, `pluginManifest()` and
`marketplaceManifest()`.

**How it was found:** not part of the original Task 6 audit — Findings 1 and
2 above were the only two `EXPECTED_DIFFERENCES` entries masking genuine
gaps; the other two entries (`.claude-plugin/plugin.json` / `hooks` and
`.cursor-plugin/plugin.json` / `hooks`) were DESIGNED differences, not
findings. Once `bootstrap.emitHooks: false` (Task 2 of the
2026-08-12-respect-user-hooks plan) closed the `hooks`-pointer differences
and Finding 1/2's fixes closed the other two, emptying
`EXPECTED_DIFFERENCES` moved `.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` from the deep-equal-only comparison group
into the byte-for-byte group for the first time. That surfaced a third,
previously-undocumented gap: both files' *values* were already correct
(the deep-equal assertions had passed all along, since JSON deep-equality is
order-insensitive), but their top-level *key order* didn't match
superpowers' hand-written files.

`pluginManifest()` built `name, version, description, author, license,
repository, homepage, keywords`; superpowers' real
`.claude-plugin/plugin.json` uses `name, description, version, author,
homepage, repository, license, keywords`. `marketplaceManifest()` always
appended `owner` after `plugins`; superpowers' real
`.claude-plugin/marketplace.json` places `owner` before `plugins`. Per
`git show b3e99ca`, this order was deliberately chosen only to keep
*everyharness's own generated output* byte-identical across a refactor
("verified via the full suite... snapshot unchanged") — it had never been
checked against superpowers' real files, because neither file had
previously been in the dogfood test's byte-exact group.

None of the three config-level mechanisms (`bootstrap.emitHooks`,
`marketplace.description`, `harnesses.overrides`) can fix this: `deepMerge`
only ever sets, recursively merges, or deletes keys — it never reorders keys
already present in the base object — and `marketplaceManifest()` has no
`deepMerge`/override step applied to it at all. Reordering required an
adapter-code change, which was out of the original Task 3 brief's scope; it
was escalated as BLOCKED and authorized as Task 4 of the
2026-08-12-respect-user-hooks plan.

### Resolution (2026-08-12)

Fixed by commit `ef53d66` ("fix: claude-code manifest key order matches the
canonical hand-written files"): reordered `pluginManifest()`'s object
construction to `name, description, version, author, homepage, repository,
license, keywords` and `marketplaceManifest()`'s to set `owner` before
`plugins`, each with a comment naming superpowers' hand-written manifests as
the canonical order. Scoped to claude-code.ts only — `baseManifestFields()`
and every other adapter (cursor, codex, devin, kimi) were already
byte-exact with the existing shared order and were left untouched. The
kitchen-sink snapshot's two claude-code entries updated accordingly; every
other snapshot entry stayed byte-identical.

**Ruling (2026-08-12):** Jesse ruled that JSON key order is explicitly NOT
something everyharness cares about — the byte-exactness this Resolution
chased was never a real goal, only an artifact of the dogfood test's own
comparison method. The `ef53d66` reorder above was reverted (see the
2026-08-12-per-harness-emithooks plan, Task 2): `pluginManifest()` and
`marketplaceManifest()` are back to their pre-`ef53d66` field order (verified
exact against `git show 58bd63a:tests/__snapshots__/generate.test.ts.snap`),
and the "canonical order" comments are gone. `tests/dogfood.test.ts` now
asserts semantic JSON equality (parsed, `toEqual`) instead of byte
comparison for all eight files; formatting and key order are explicitly out
of scope and documented as such in the test's header.

## Status

Findings 1 and 2 are fixed as of this branch (2026-08-12); the dogfood
test's `EXPECTED_DIFFERENCES` map (`tests/dogfood.test.ts`) is empty and all
eight of superpowers' hand-maintained manifests regenerate semantically
identical. Finding 3 was fixed and then partially reverted per the ruling
above: the underlying values remain correct (they always were — the gap was
never in `deepMerge`/override expressiveness), but claude-code's field order
no longer matches superpowers' hand-written files byte-for-byte, and the
dogfood test no longer requires it to.
