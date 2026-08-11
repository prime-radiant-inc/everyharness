# everyharness Init/Import/Docs/Dogfood Implementation Plan (Plan 4 of series)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the remaining v1 CLI surface (`init`, `import`), generated per-harness install docs + support-matrix doc + plugin-repo CI workflow, the superpowers dogfood test, and the recorded Plan 4 backlog (mcp collision fix, hook double-fire investigation, CRLF note, matrix wording).

**Architecture:** Unchanged core. `init` scaffolds, `import` converts a Claude-format plugin into an `everyharness.yaml`. Install docs come from an optional `installDoc(model)` adapter method rendered into `docs/install/<harness>.md` + a marker-delimited README section + `docs/support-matrix.md`. The dogfood test imports the real superpowers checkout and asserts semantic equivalence of generated vs. hand-maintained manifests, with a documented expected-differences map.

**Tech Stack:** unchanged (TS strict ESM/NodeNext, commander/yaml/zod/ajv, vitest).

**Spec:** `docs/superpowers/specs/2026-08-10-everyharness-design.md`
**Recorded inputs:** Plan 3 doc's stays-recorded list (mcp collision bug, hook double-fire EMPIRICAL CHECK, CRLF/.gitattributes note, codex-vs-devin matrix wording, marker-in-context cosmetic).

## Global Constraints

- Node `>=20`, ESM, TS strict, `.js` imports; runtime deps stay exactly commander/yaml/zod/ajv.
- Exit codes unchanged. No silent drops. Marker rules per Plan 3's corrected Global Constraints.
- `init`/`import` never overwrite existing files without `--force` (same refusal philosophy as generate).
- Generated docs are drift-tracked files like any other emission (hashes in the manifest, pruned when adapters are excluded).
- Superpowers dogfood test reads the LOCAL checkout at `/home/jesse/git/superpowers/superpowers` via `git show dev:<path>` extraction into a temp dir (never mutates that repo; skips gracefully with a logged note when the repo is absent — CI on GitHub won't have it, so the test is `describe.skipIf`-gated on repo presence; the full comparison runs locally).
- TDD; pristine output.

## Design decisions locked by this plan

1. **mcp collision fix:** agent-plugins-1.0 skips its `mcp.json` emission with warning `mcp.json is occupied by the source MCP config (components.mcp); agent-plugins-1.0 mcp output skipped — rename the source to .mcp.json` when `config.components.mcp === 'mcp.json'`. plugin.json still emitted.
2. **`installDoc` is an optional adapter method** `installDoc?(model: PluginModel): string` returning markdown BODY (no marker; the doc generator adds marker + heading). A new emission stage in `generate()` collects docs from active adapters that implement it and emits `docs/install/<adapter-name>.md` (marker line 1, `# Installing <plugin> on <harness display name>`, body) plus `docs/support-matrix.md` (marker, rendered matrix table, a notes section: agents-marketplace row explains droid/grok/copilot ride the claude-code layout; codex `bootstrap: partial` = native skill discovery only, devin `none` = no injection mechanism documented; CRLF note: repos consuming shell-hook output should add `hooks/everyharness/* text eol=lf` to .gitattributes or accept drift warnings on autocrlf checkouts).
3. **README injection:** between `<!-- everyharness:install:start -->` / `<!-- everyharness:install:end -->` markers in the PLUGIN's README.md — only when both markers already exist (the tool never creates or restructures a user README; absence = no injection, one informational warning `README.md has no everyharness install markers; skipping install-matrix injection`). Injected content: a per-harness install table (harness, install command with `<owner>/<repo>` derived from config.repository when parseable, else `<your-repo>`). The injected README region participates in drift tracking as follows: README.md is NOT recorded in the manifest (user file); `validate` ignores it. Regeneration re-injects idempotently (replace region content).
4. **Install command ground truth** (from superpowers README research, generalized; `REPO` = owner/repo from config.repository, `URL` = full https URL): claude-code `claude /plugin marketplace add REPO` then `/plugin install <name>@<name>-dev`… — v1 keeps this simple and honest: each adapter's installDoc states the mechanism and the file(s) it emitted, with the harness's generic install command form and a "consult your harness's plugin docs" fallback. No fabricated marketplace listings.
5. **`init`:** `everyharness init [--dir]` refuses in a dir already containing everyharness.yaml; writes everyharness.yaml (name from dir basename, version 0.1.0, description placeholder, bootstrap.generate true), `skills/getting-started/SKILL.md` (frontmatter name/description + two-line body), then runs generate() and prints next steps. `--force` re-scaffolds config only (never deletes user files).
6. **`import`:** `everyharness import [--dir]` refuses when everyharness.yaml exists (no --force in v1 — import is a one-time conversion); requires `.claude-plugin/plugin.json`; maps name/version/description/author/homepage/repository/license/keywords; detects components by presence (skills/, commands/, agents/, hooks/hooks.json, .mcp.json — including non-default manifest keys `commands`/`agents`/`hooks`/`mcpServers` paths); bootstrap: if a skill named `using-<name>` exists → `bootstrap.skill`, else `bootstrap.generate: true`; carries unknown plugin.json extras (e.g. nothing today) into `harnesses.overrides.claude-code`; prints a summary of what it found and warns `review everyharness.yaml, then run everyharness generate` WITHOUT auto-running generate (the user should eyeball first; opposite of init, deliberate).
7. **Dogfood test:** extracts superpowers@dev's real component tree (skills/, hooks/hooks.json, manifests) into a temp dir via `git archive dev` piped to tar (read-only), writes a hand-crafted everyharness.yaml (bootstrap.skill using-superpowers; overrides: codex.interface + codex keywords ordering + kimi.skillInstructions/interface + cursor displayName "Superpowers" + agents-marketplace interface.displayName "Superpowers Dev" + claude-code homepage) then asserts DEEP-EQUAL between generated and real manifests for: .claude-plugin/plugin.json, .devin-plugin/plugin.json, .codex-plugin/plugin.json, .kimi-plugin/plugin.json, gemini-extension.json, .agents/plugins/marketplace.json — modulo a DOCUMENTED `EXPECTED_DIFFERENCES` map (e.g. cursor/claude hooks pointer paths differ by design: everyharness uses hooks/everyharness/…; superpowers' GEMINI.md has a tools reference line ours doesn't; marketplace.json plugins[0] description/version fields we emit that superpowers' .agents copy lacks). Every entry in the map carries a one-line reason. The test FAILS on any undocumented difference — that's the point.
8. **Hook double-fire investigation (recorded EMPIRICAL CHECK):** a timeboxed investigation task, not code: determine whether `claude` CLI (installed locally) can load a plugin from a directory in a headless/scriptable way (`claude --help`, plugin docs via `claude plugin --help`) and if so run the kitchen-sink bootstrap check (user hooks at default path + manifest hooks pointer → count SessionStart injections). Findings recorded in docs/superpowers/plans/ as a short note + adapter comment updated. If headless loading isn't feasible, document the manual test procedure in the note and leave the adapter comment's open-question marker.

## File Structure (this plan)

```
src/
  adapters/types.ts        # modify: optional installDoc method
  adapters/*.ts            # modify: installDoc implementations (all 11)
  adapters/agent-plugins.ts# modify: mcp collision skip (decision 1)
  docs-emit.ts             # new: install-docs + support-matrix emission + README injection
  generate.ts              # modify: docs stage
  init.ts                  # new
  import.ts                # new
  cli.ts                   # modify: init/import commands
tests/
  docs-emit.test.ts, init.test.ts, import.test.ts, dogfood.test.ts  # new
```

---

### Task 1: mcp collision fix + installDoc interface + docs emission stage
Decision 1 fix (+ test with components.mcp: mcp.json fixture — generation now succeeds with the warning, agent-plugins emits plugin.json only). `installDoc?` added to HarnessAdapter; `src/docs-emit.ts` with the docs/support-matrix emission per decision 2 (adapters without installDoc yet → no doc file); generate() wires the stage AFTER adapter emission, BEFORE dedupe close (docs are normal GeneratedFiles). claude-code gets the first installDoc implementation (proves the pipe). Tests: exact doc content for claude-code; support-matrix.md contains 11 rows + notes section incl. CRLF note. Commit per piece (fix, then stage).

### Task 2: installDoc for the remaining 10 adapters
Each states: what was emitted, mechanism, generic install-command form (decision 4), caveats (cursor user-hooks not translated; codex native-discovery-only bootstrap; kimi generate-mode unsupported; agent-plugins fixed skills/ location; opencode/pi package.json ownership; hermes Path gotcha irrelevant to users — skip internals, user-facing only). Exact-content test for two representative adapters + structural (marker/heading) tests for all. Commit.

### Task 3: README injection (decision 3)
docs-emit README region replace; warning when markers absent; idempotent re-injection test; kitchen-sink fixture README gains markers (fixture change) so e2e covers injection. Commit.

### Task 4: `init` (decision 5)
TDD: temp dir → init → files exist, generate ran (manifest present), refusal on existing everyharness.yaml, --force re-scaffolds config only. CLI wiring. Commit.

### Task 5: `import` (decision 6)
TDD: synthetic Claude plugin fixture (plugin.json + skills + commands + hooks + .mcp.json) → everyharness.yaml matches expected mapping; using-<name> bootstrap detection both ways; refusal when yaml exists; summary output. CLI wiring. Commit.

### Task 6: superpowers dogfood test (decision 7)
skipIf-gated on repo presence; EXPECTED_DIFFERENCES map with reasons; deep-equal assertions per manifest. This task's implementer WILL discover real mismatches — expected workflow: adjust the dogfood fixture's overrides where superpowers content is plugin-specific, extend EXPECTED_DIFFERENCES (with reasons) where the difference is designed, and report (not fix) any everyharness BUG it exposes (controller decides). Commit.

### Task 7: hook double-fire investigation (decision 8)
Timebox ~30 min of probing. Deliverable: `docs/superpowers/plans/2026-08-11-hook-double-fire-findings.md` + updated comment in claude-code adapter. Commit.

### Task 8: v0.4.0 wrap
cli e2e additions (init/import happy paths via spawned CLI), README status line update (init/import/docs done; remaining: container testing), TOOL_VERSION/package.json 0.4.0 + lockfile. Commit.

## Self-Review Notes
- All recorded Plan 4 inputs are owned: mcp collision (T1), double-fire (T7), CRLF note (T1 support-matrix notes), matrix wording (T1 notes), marker-in-context cosmetic (NOT fixed — stays recorded, cosmetic).
- Interface additions are optional-method based; no adapter forced to implement installDoc before its task.
- Dogfood failure mode is designed: undocumented difference = red test; that is the acceptance criterion from the spec.
