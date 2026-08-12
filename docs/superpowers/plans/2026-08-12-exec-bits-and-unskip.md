# Deep-Check Coverage: Publishable Descriptors + Exec Bits (issues #8, #9)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore deep-check coverage for repository-sourced marketplaces by rewriting the entry source in the throwaway copy (#8), and add an exec-bit preservation check for skills that ship executable scripts (#9).

**Architecture:** Both changes live in `checks/run-checks.sh`'s deep tier. #8 replaces the `skip_if_nonlocal_source` guard with a source rewrite in `$WORK` right after the copy (before the git snapshot commit, so cloning installers see the rewritten file). #9 adds a `deep_exec_bits` pass after the per-harness install checks, reusing the installs they already performed.

**Tech Stack:** bash + jq (checks), TypeScript/vitest (tests), docker (live verification).

## Global Constraints

- All 338 existing tests stay green (`npm test`); TDD for every change.
- Checks conventions: `set -u` not `-e`; TAP `ok`/`not ok`/`skip` lines; shared FAILED/exit-3 accounting; fully offline; no API keys; CLI absent → skip never not-ok; never write into the mounted plugin dir (`$PLUGIN_ROOT`); `$WORK`/`$HOME` are throwaway.
- No new npm deps; `bash -n` and shellcheck clean; match the script's existing comment style.
- Reference artifact for #9 (read, adapt, generalize — its per-harness install commands and find-based cache location are proven ground truth): `/tmp/claude-1000/-home-jesse-git-superpowers-superpowers/e58ccd70-08ca-4e00-9488-5c195d75e79e/scratchpad/verify-exec-bits.sh`. Its `<relative-scripts-dir>` argument must be generalized to "every executable file under the plugin's skills tree".
- Live container verification (image `ghcr.io/prime-radiant-inc/everyharness-container:latest`, in local docker cache) is REQUIRED for both tasks; paste real TAP output in reports.

---

### Task 1: Rewrite the marketplace entry source in the throwaway copy (#8)

**Files:**
- Modify: `checks/run-checks.sh` — `skip_if_nonlocal_source` (~line 272, plus its two call sites in `deep_claude_code` and `deep_copilot`), `market_source_is_local` (now unused — remove), and the `run_deep_checks` staging block (~lines 580–592)
- Test: the checks tests in `tests/test-command.test.ts` (the sed-extract unit tests for `market_source_is_local` go away with it; add one for the rewrite)

**Interfaces:**
- Consumes: `$WORK` staging in `run_deep_checks`; the emitted `.claude-plugin/marketplace.json`.
- Produces: a `rewrite_market_source_local()` function used during staging; claude-code/copilot deep checks that run for repository-sourced descriptors.

**Requirements (from issue #8, verified by its author against proving-it-works):**

1. In `run_deep_checks`, right after `cp -r "$PLUGIN_ROOT" "$WORK"` and BEFORE the `git add`/`commit` snapshot (cloning installers must see the rewritten file), rewrite every entry source in `$WORK/.claude-plugin/marketplace.json` to `"./"`:
   ```sh
   # A publishable descriptor points its source at the repository, which cannot
   # be fetched in an offline container. Rewrite the source to "./" in the
   # THROWAWAY copy so the local install path works; everything else about the
   # descriptor (name, entry, category, keywords, strict) stays as generated.
   # Container-only accommodation — the author's tree is never touched.
   rewrite_market_source_local() {
     local mk="$WORK/.claude-plugin/marketplace.json"
     [ -f "$mk" ] || return 0
     local tmp="$mk.tmp"
     if jq '(.plugins[]? | .source) = "./"' "$mk" > "$tmp" 2>/dev/null; then
       mv "$tmp" "$mk"
       MARKET_REWRITE_OK=1
     else
       rm -f "$tmp"
       MARKET_REWRITE_OK=0
     fi
   }
   ```
   (`MARKET_REWRITE_OK` initialized to 1 before the call so `set -u` is safe on plugins without the file.)
2. Delete `skip_if_nonlocal_source` and `market_source_is_local` and the two guard calls. In their place, `deep_claude_code` and `deep_copilot` skip ONLY when the rewrite failed: `[ "$MARKET_REWRITE_OK" = 1 ] || { skip "$harness" "marketplace.json could not be rewritten for offline install (malformed descriptor)"; return; }` — a malformed descriptor still reports rather than silently passing (issue requirement).
3. Update the comment block that used to explain the guard so it documents the rewrite instead.
4. Tests: remove/replace the `market_source_is_local` sed-extract unit tests; add a sed-extract test for `rewrite_market_source_local` proving (a) a url-object source becomes `"./"` while name/strict/keywords survive, (b) a marketplace.json that is invalid JSON sets `MARKET_REWRITE_OK=0`, (c) a missing file leaves `MARKET_REWRITE_OK=1`. Keep the sandboxed-PATH integration test green.

- [ ] **Step 1: Write failing tests** (sed-extract style, per requirement 4)
- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement** (requirements 1–3); `bash -n` + shellcheck clean
- [ ] **Step 4: Full `npm test` green**
- [ ] **Step 5: Live verification (required):** build the CLI; make a temp copy of `fixtures/kitchen-sink` with `marketplace.source: repository` and `repository: https://github.com/prime-radiant-inc/everyharness` added to everyharness.yaml; generate it; run `everyharness test` against it. `install-claude-code` and `install-copilot` must be **ok** (installed under the real marketplace name), not skip — plus the whole tier otherwise ok/skip, exit 0. Also run against unmodified kitchen-sink output to prove the local-source path still passes. Paste both TAP outputs.
- [ ] **Step 6: Commit** — `fix: deep checks rewrite the marketplace source in the throwaway copy (#8)`

---

### Task 2: Exec-bit preservation check (#9)

**Files:**
- Modify: `checks/run-checks.sh` — new `deep_exec_bits` pass invoked from `run_deep_checks` AFTER the per-harness install checks (it reuses their installs)
- Modify: `fixtures/kitchen-sink/` — add an executable script to one skill (e.g. `skills/greeting/scripts/hello.sh`, mode 755, a two-line `#!/usr/bin/env bash` + `echo hello`) so the check exercises live; regenerate anything that tracks fixture contents (the generated-file manifest records exec bits — inspect how fixture outputs/snapshots stay in sync and keep them consistent)
- Test: checks tests in `tests/test-command.test.ts`

**Interfaces:**
- Consumes: `$PLUGIN_ROOT` (source tree), `$WORK`, the installs already performed by `deep_claude_code`/`deep_gemini`/`deep_codex`/`deep_copilot`/`deep_droid`/`deep_grok`/`deep_hermes`.
- Produces: TAP lines named `exec-bits-source` and `exec-bits-<harness>`.

**Requirements (from issue #9 and the reference script):**

1. **Discovery:** find every executable regular file under the plugin's skills root in `$PLUGIN_ROOT` (`find "$skills_root" -type f -perm -u+x`), recording paths relative to the plugin root. If there are none, emit exactly one line — `skip exec-bits: plugin ships no executable skill files` — and return (most plugins ship none; they pay one line, no installs, no finds).
2. **Source baseline first:** the discovery above IS the source-tree truth; additionally verify each discovered file is executable in `$WORK` (the staged copy installs actually came from). If any lost the bit in staging, `not ok exec-bits-source: ...` naming the files, and return without per-harness checks (a broken baseline makes a clean sweep meaningless — issue requirement).  Otherwise `ok exec-bits-source: every executable skill file is executable in the staged copy (N file(s))`.
3. **Per-harness:** for each of claude-code, gemini, codex, copilot, droid, grok, hermes: if the CLI is absent → `skip exec-bits-<harness>: <cli> not on PATH`. Otherwise locate the installed copy by `find` under that harness's root (claude-code `~/.claude/plugins`, gemini `~/.gemini/extensions`, codex `~/.codex/plugins`, copilot `~/.copilot/installed-plugins`, droid `~/.factory/plugins`, grok `~/.grok/installed-plugins`, hermes `~/.hermes/plugins`) — find the installed skills root by matching a known relative path (e.g. the directory of the first discovered executable), never a hardcoded versioned path (caches are version/hash-suffixed — issue requirement). No installed copy found → `skip exec-bits-<harness>: no installed copy found under <root>` (the install check earlier already reported the install itself). Then assert every discovered file exists AND is executable at the installed location: all good → `ok exec-bits-<harness>: every executable skill file survived at <dir>`; any bad → `not ok exec-bits-<harness>: lost the executable bit: <files>` (through `oneline`-style truncation conventions where captures are involved).
4. `skip exec-bits-kimi: install is TUI-only` alongside the others; opencode and pi are not install-by-copy harnesses here (opencode loads the plugin in place, pi runs the emitted TS directly) — omit them with a one-line comment saying why rather than emitting misleading skips.
5. Unit tests (sed-extract style + sandboxed integration): (a) discovery snippet finds executables and ignores non-executable files; (b) a plugin with no executables produces exactly the single `skip exec-bits:` line (run the real script against a no-executables fixture copy with sandboxed PATH); (c) with the kitchen-sink fixture (which now ships hello.sh), sandboxed PATH yields `ok exec-bits-source` (or the staged-copy check) plus per-harness CLI-absent skips, exit 0.

- [ ] **Step 1: Write failing tests** (requirement 5)
- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement** `deep_exec_bits` + fixture script; `bash -n` + shellcheck clean
- [ ] **Step 4: Full `npm test` green**
- [ ] **Step 5: Live verification (required):** run `everyharness test` against regenerated kitchen-sink output in the real container. Expect `ok exec-bits-source` and `ok exec-bits-<harness>` for claude-code/gemini/codex/copilot/droid/grok/hermes (matching the issue's observed all-pass table), `skip exec-bits-kimi`, exit 0. Paste the TAP output.
- [ ] **Step 6: Commit** — `feat: deep check that executable skill scripts survive every install (#9)`
