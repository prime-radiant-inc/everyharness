# `everyharness bump` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `bump` command that updates a plugin's release version everywhere it appears, with feature parity to superpowers' `scripts/bump-version.sh` + `.version-bump.json` (which it is intended to replace).

**Architecture:** `everyharness.yaml` is the version's source of truth; `generate` already propagates it into every generated manifest. `bump <version>` edits everyharness.yaml (format-preserving), edits any extra declared files (the ones everyharness doesn't own, e.g. package.json), regenerates, then audits. `--check` compares declared files against the config version AND runs the existing generated-file drift check. `--audit` greps the repo for the current version outside declared/generated/excluded files.

**Tech Stack:** TypeScript (commander, `yaml` package's parseDocument for format-preserving YAML edits), vitest. No container work.

## Global Constraints

- All 341 existing tests stay green; TDD; no new dependencies (the `yaml` package is already a dependency and provides `parseDocument` for comment/format-preserving edits).
- Parity checklist with superpowers' tool (every item must exist):
  1. Declared files as `{path, field}` with dotted field paths, numeric segments addressing array indices (`plugins.0.version`); JSON and YAML files supported.
  2. `--check`: per-file version report, `MISSING` lines for absent declared files, drift detection across all reported versions, non-zero exit on drift.
  3. `--audit`: determine current version, grep the repo for it, report hits in files that are neither declared, nor generated, nor excluded; advisory (exit 0 even with findings) with guidance text; always-on excludes `.git`, `node_modules`, binary files.
  4. `bump <version>`: format validation, preflight (every declared field readable before any write), per-file `old -> new` report lines, `SKIP (missing)` for absent declared files, automatic audit afterward.
- everyharness-specific semantics:
  - Version format: reuse the existing anchored semver regex from the config schema (with prerelease/build suffix support) — stricter than superpowers' prefix match, intentionally.
  - `bump <version>` also rewrites `everyharness.yaml`'s `version` (format-preserving via `parseDocument`) and then runs `generate()` so every generated manifest updates; generated files are correct by construction and are NOT listed in `bump.files`.
  - `--check` additionally runs the existing drift check (`checkDrift`) — a stale generated file IS version drift; report it as such.
  - `--audit` excludes: the declared files, `everyharness.yaml`, every path in `.everyharness/manifest.json` (generated files), configured `bump.audit.exclude` patterns, plus the always-on set.
  - Exit codes follow the tool's convention: 0 ok / 1 ConfigError / 3 drift (for `--check` with drift or missing files). Audit is advisory: exit 0.
- Config addition (`everyharness.yaml`):
  ```yaml
  bump:
    files:                      # extra files everyharness does not generate
      - path: package.json
        field: version          # dotted path; numeric segments index arrays
    audit:
      exclude:                  # audit-only ignore patterns (basename or dir name match, like grep --exclude/--exclude-dir)
        - CHANGELOG.md
        - RELEASE-NOTES.md
  ```
  Both keys optional; `bump` with no config still bumps everyharness.yaml + regenerates + audits.
- `bump.files` paths must pass the same containment rules as other config paths (no absolute paths, no `..`); a declared path equal to `everyharness.yaml` or a generated path (in the manifest) is a ConfigError at bump time (generated files are owned by generate).

---

### Task 1: Config schema + field-path editing helpers

**Files:**
- Modify: `src/config.ts` (add `bump` key to schema + `EveryharnessConfig`)
- Create: `src/field-edit.ts`
- Test: `tests/config.test.ts` (extend), `tests/field-edit.test.ts` (create)

**Interfaces (binding for Task 2):**
```ts
// config
bump?: {
  files?: { path: string; field: string }[]
  audit?: { exclude?: string[] }
}

// src/field-edit.ts
export function readField(filePath: string, field: string): string
// throws ConfigError with a clear message when the file is unreadable,
// unparseable, the field path is absent, or the value is not a string
export function writeField(filePath: string, field: string, value: string): void
// JSON: JSON.parse + mutate + JSON.stringify(obj, null, 2) + trailing newline
// YAML: parseDocument + setIn + doc.toString() — preserves comments/format
// dotted field paths: split on '.', numeric segments index arrays
// file type by extension: .json / .yaml / .yml; anything else -> ConfigError
```

- [ ] **Step 1: Write failing tests**

Config (`tests/config.test.ts`, follow existing patterns):
```ts
// accepts bump key
cfg = loadConfig(rootWith({ bump: { files: [{ path: 'package.json', field: 'version' }], audit: { exclude: ['CHANGELOG.md'] } } }))
expect(cfg.bump?.files).toEqual([{ path: 'package.json', field: 'version' }])
// rejects traversal-y paths
expect(() => loadConfig(rootWith({ bump: { files: [{ path: '../x.json', field: 'version' }] } }))).toThrow()
```

Field-edit (`tests/field-edit.test.ts`):
```ts
// JSON simple field round-trip
writeField(j, 'version', '2.0.0'); expect(readField(j, 'version')).toBe('2.0.0')
// JSON dotted array path (superpowers' real case)
// file: { "plugins": [ { "version": "1.0.0" } ] }
writeField(j2, 'plugins.0.version', '2.0.0')
expect(JSON.parse(readFileSync(j2, 'utf8')).plugins[0].version).toBe('2.0.0')
// YAML preserves comments
// file: "# release version\nversion: 1.0.0\nname: x\n"
writeField(y, 'version', '2.0.0')
expect(readFileSync(y, 'utf8')).toContain('# release version')
expect(readFileSync(y, 'utf8')).toContain('version: 2.0.0')
// missing field path -> ConfigError naming file and field
expect(() => readField(j, 'nope.0.deep')).toThrow(ConfigError)
// unsupported extension -> ConfigError
expect(() => readField('x.toml', 'version')).toThrow(ConfigError)
// non-string value -> ConfigError
```

- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement** (schema per Interfaces; reuse the existing componentPath-style validation for `bump.files[].path` — inspect how component paths are z.preprocess-normalized/validated and apply the same charset/dot-segment rules)
- [ ] **Step 4: Tests pass; full `npm test` green**
- [ ] **Step 5: Commit** — `feat: bump config key and field-path edit helpers`

---

### Task 2: The `bump` command

**Files:**
- Create: `src/bump.ts`
- Modify: `src/cli.ts` (new `bump` command)
- Modify: `README.md` (document the command + config, positioned as the replacement for per-repo bump scripts)
- Modify: `fixtures/kitchen-sink/everyharness.yaml` + add `fixtures/kitchen-sink/package.json` (`{ "name": "kitchen-sink", "version": <current fixture version>, ... minimal }`) so the fixture exercises `bump.files`
- Test: `tests/bump.test.ts` (create)

**Interfaces:**
- Consumes: `loadConfig`, `generate`, `checkDrift`, `readField`/`writeField` (Task 1), the version regex from config.
- Produces:
  ```ts
  export function bumpVersion(root: string, newVersion: string): BumpResult   // bump + generate + audit
  export function bumpCheck(root: string): CheckResult                        // report + drift; caller maps to exit 3
  export function bumpAudit(root: string): AuditResult                        // advisory report
  ```
  CLI: `everyharness bump <version>`, `everyharness bump --check`, `everyharness bump --audit` (mutually exclusive; commander handles `<version>` optional-with-flags — inspect how existing commands structure options).

**Requirements:**

1. **bump `<version>`:** validate against the anchored semver regex (reject with ConfigError message matching the config schema's wording). Preflight: loadConfig succeeds; every `bump.files` entry readable via `readField` (all errors reported before any write). Then: writeField each declared file (report `SKIP (missing)` for absent files — parity), rewrite everyharness.yaml's `version` via `parseDocument` (comments/format preserved — assert in tests), call `generate(root)` (default adapters; surface its warnings), print `path (field)  old -> new` lines, then run the audit and print its report.
2. **--check:** print each declared file's `path (field)  version` (or `MISSING`), plus `everyharness.yaml (version)  <v>`; drift = more than one distinct version among present files OR any missing declared file OR `checkDrift(root)` reporting generated-file drift (report those paths as `generated file stale: <path>` lines). Exit 3 on drift (CLI maps), 0 clean, matching the tool's existing exit-code table.
3. **--audit:** current version = the config's `version`. Walk the repo (respecting always-on excludes `.git`, `node_modules`; skip binary files by null-byte sniff of the first 8KB), grep for the literal version string, and report hits in files that are NOT: declared in `bump.files`, `everyharness.yaml`, listed in `.everyharness/manifest.json`, or matched by `bump.audit.exclude` (match a pattern against basename or any path segment, mirroring grep's `--exclude`/`--exclude-dir` semantics). Findings print the parity guidance ("add them to bump.files … or bump.audit.exclude"); none prints the all-clear. Always exit 0.
4. **Wiring:** CLI command with help text; ConfigError → exit 1, check drift → exit 3, consistent with the existing cli.ts error mapping (inspect and reuse).
5. **README:** document the command, the config keys, the parity intent (one sentence: designed to replace per-repo bump scripts like superpowers' bump-version.sh), and the exit codes.
6. **Fixture:** kitchen-sink gains `bump: { files: [{ path: package.json, field: version }], audit: { exclude: [] } }`-equivalent yaml and a minimal package.json at the fixture version so an end-to-end test can bump a copy of the fixture and assert: everyharness.yaml, package.json, and regenerated manifests (spot-check `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` plugins.0.version) all show the new version, and the audit is clean.

- [ ] **Step 1: Write failing tests** — unit: version-format rejection; check with a deliberately drifted extra file reports drift; audit flags a planted undeclared file containing the version and honors an exclude pattern; missing declared file → SKIP on bump / MISSING+drift on check. End-to-end: copy kitchen-sink fixture to a temp root, run `bumpVersion(tmp, '9.9.9')`, assert requirement 6's outcomes plus comment preservation in the yaml (the fixture yaml has at least one comment — add one if not).
- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Full `npm test` green**
- [ ] **Step 5: Parity self-check (required, in report):** map each behavior of superpowers' scripts/bump-version.sh (read it at /home/jesse/git/superpowers/superpowers/scripts/bump-version.sh) to its everyharness equivalent in a table; any behavior without an equivalent must be called out explicitly.
- [ ] **Step 6: Commit** — `feat: everyharness bump — version bump with check, audit, and regeneration`
