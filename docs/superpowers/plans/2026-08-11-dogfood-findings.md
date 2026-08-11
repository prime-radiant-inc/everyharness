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

## Status

Both findings are backlog for Plan 5 or later — reported per Task 6's
process rule, not fixed in Plan 4. `tests/dogfood.test.ts`'s
`EXPECTED_DIFFERENCES` map continues to document and tolerate both until
one of the fixes above (or an equivalent) lands.
