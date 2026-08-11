# Eval-Feedback Fixes Implementation Plan (issues #1–#5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five issues filed from the elements-of-style 13-harness port: actionable marker warning (#2), hermes install-doc caveats (#3, #5), correct droid install command (#4), and deep install-verification checks in `everyharness test` (#1).

**Architecture:** Tasks 1–3 are targeted string/doc emissions in existing adapters and docs-emit. Task 4 extends `checks/run-checks.sh` with a second tier of checks that perform real installs into each harness CLI inside the container and assert the harness enumerates the plugin's skills, adapted from a proven working script.

**Tech Stack:** TypeScript (Node, zod, vitest), bash (checks script), docker (live verification only).

## Global Constraints

- All 315 existing tests must stay green (`npm test`).
- TDD for every change: failing test first, then implementation.
- `checks/run-checks.sh` conventions are binding: `set -u` (deliberately NOT `-e`), TAP-ish output lines `ok NAME: detail` / `not ok NAME: detail` / `skip NAME: reason`, overall exit **3** when any `not ok` was printed, 0 otherwise.
- Checks must never invoke an LLM and never need API keys; everything runs offline.
- Any deep check whose harness CLI is absent from PATH must emit `skip`, never `not ok` (the script must remain runnable outside the container).
- No new npm dependencies.
- Match surrounding code style exactly (comment density, naming, quoting).
- `everyharness` never creates or restructures a user README (design doc rule) — warnings must be actionable instead.
- Install docs are generated files under `docs/install/<harness>.md`, emitted by each adapter's `installDoc(model)`.

---

### Task 1: Name the install markers in the warning and in import output (#2)

**Files:**
- Modify: `src/docs-emit.ts` (warning string near line 126)
- Modify: `src/cli.ts` (import success message near line 39)
- Test: existing docs-emit and cli/import test files (locate with `grep -rn "install markers" tests/`)

**Interfaces:**
- Consumes: `injectReadme()` in `src/docs-emit.ts`; marker constants `README_START`/`README_END` (lines 91–92).
- Produces: no signature changes — string content only.

- [ ] **Step 1: Write failing tests**

Extend the existing test that asserts the no-markers warning so it requires both marker strings to appear in the warning text:

```ts
expect(result.warning).toContain('<!-- everyharness:install:start -->')
expect(result.warning).toContain('<!-- everyharness:install:end -->')
```

Extend the existing import CLI-output test (or add one beside it) asserting the import success message mentions `<!-- everyharness:install:start -->`.

- [ ] **Step 2: Run tests to verify they fail** (`npx vitest run <files>`)

- [ ] **Step 3: Implement**

In `src/docs-emit.ts`, replace the warning value with a two-line actionable message built from the existing constants (do not duplicate the literals):

```ts
warning: `README.md has no everyharness install markers; skipping install-matrix injection\n  add ${README_START} and ${README_END} where the table should go`,
```

In `src/cli.ts`, extend the import success message with one sentence: if the repo has a `README.md`, adding `<!-- everyharness:install:start -->` and `<!-- everyharness:install:end -->` markers lets `generate` inject the install matrix. Keep the existing sentence intact; append, don't rewrite.

- [ ] **Step 4: Run tests to verify pass; run full `npm test`**

- [ ] **Step 5: Commit** — `fix: name the install markers in the no-markers warning and import output (#2)`

---

### Task 2: Hermes install-doc Caveats section (#3, #5)

**Files:**
- Modify: `src/adapters/hermes.ts` (`installDoc`, lines 221–247)
- Test: the existing hermes adapter test file (locate with `grep -rln "installDoc\|What gets emitted" tests/ | grep -i hermes`)

**Interfaces:**
- Consumes: `installDoc(model)` string builder; `config.name`.
- Produces: same signature; doc gains a `## Caveats` section.

- [ ] **Step 1: Write failing tests** asserting the generated hermes install doc contains a `## Caveats` heading and covers all three items:

```ts
expect(doc).toContain('## Caveats')
expect(doc).toContain("doesn't contain plugin.yaml or __init__.py")
expect(doc).toContain('hermes plugins enable')
expect(doc).toContain('__pycache__')
```

- [ ] **Step 2: Run to verify fail**

- [ ] **Step 3: Implement** — append to the `lines` array in `installDoc`:

```ts
'',
'## Caveats',
'',
`- Hermes prints \`${config.name} doesn't contain plugin.yaml or __init__.py. It may not be a valid Hermes plugin.\` during install. That warning is expected — everyharness emits those files under \`.hermes-plugin/\`, which Hermes locates after the warning. Confirm the install with \`hermes plugins list --plain --no-bundled\`.`,
`- \`hermes plugins enable\` takes the manifest name (\`${config.name}\`), not the checkout directory name — the two differ whenever the directory is named something else.`,
'- Hermes imports `.hermes-plugin/__init__.py` as a Python package on every load, so Python writes `.hermes-plugin/__pycache__/` next to it. Add `__pycache__/` to your `.gitignore`; everyharness never edits user files, so it will not do this for you.',
```

(Adjust exact wording to match the file's voice, but every fact above must be present.)

- [ ] **Step 4: Run tests; full `npm test`**

- [ ] **Step 5: Commit** — `fix: document hermes install warning, enable-name gotcha, and __pycache__ litter (#3, #5)`

---

### Task 3: Correct the droid install command; stop claiming the three clients are analogous (#4)

**Files:**
- Modify: `src/adapters/agents-marketplace.ts` (`installDoc`, lines 44–66, and the ground-truth comment at 39–43)
- Test: the existing agents-marketplace test file

**Interfaces:**
- Consumes: `config.repository` (string | undefined), `config.name`.
- Produces: same `installDoc` signature.

**Ground truth (verified in the container, issue #4):** droid names a marketplace after its *source* — the clone directory / repo basename — and ignores the descriptor's declared `name` (`<plugin>-dev`). So `droid plugin install <name>@<name>-dev` always fails; `<name>@<repo-basename>` works. Copilot DOES honor the declared name (`copilot plugin install <name>@<name>-dev` works after `copilot plugin marketplace add`). Grok takes a path/URL directly with `--trust` and needs no marketplace name.

- [ ] **Step 1: Write failing tests**

```ts
// repository: 'https://github.com/obra/elements-of-style', name: 'elements-of-style'
expect(doc).toContain('droid plugin install elements-of-style@elements-of-style')
expect(doc).not.toContain('droid plugin install elements-of-style@elements-of-style-dev')
expect(doc).toContain('copilot plugin install elements-of-style@elements-of-style-dev')
expect(doc).toContain('grok plugin install')
// with repository absent:
expect(docNoRepo).toContain('@<your-repo>')
```

- [ ] **Step 2: Run to verify fail**

- [ ] **Step 3: Implement**

Derive the repo basename from `config.repository` (last path segment, `.git` suffix stripped), falling back to `<your-repo>`. Emit three explicit client sections instead of the "analogous commands" paragraph:

```ts
const url = config.repository ?? '<your-repo>'
const repoName = config.repository
  ? (config.repository.split('/').pop() ?? '').replace(/\.git$/, '') || '<your-repo>'
  : '<your-repo>'
```

Droid block: `droid plugin marketplace add ${url}` then `droid plugin install ${config.name}@${repoName}` with a one-line comment in the doc that droid names marketplaces after the repo, not the descriptor's declared name. Copilot block: `copilot plugin marketplace add ${url}` then `copilot plugin install ${config.name}@${config.name}-dev` (copilot honors the declared name). Grok block: `grok plugin install ${url} --trust`. Keep the closing paragraph about effective support matching claude-code's. Update the ground-truth comment at lines 39–43 to state the droid naming rule.

- [ ] **Step 4: Run tests; full `npm test`**

- [ ] **Step 5: Commit** — `fix: droid installs by repo-derived marketplace name, split per-client install docs (#4)`

---

### Task 4: Deep install-verification checks in `everyharness test` (#1)

**Files:**
- Modify: `checks/run-checks.sh` (append a deep-check tier after the existing 12 checks)
- Modify: `src/test-command.ts` only if it enumerates/counts checks (inspect first)
- Test: existing checks-script tests (locate via `grep -rln "run-checks" tests/`), plus live container run
- Reference artifact (read, adapt, do not copy verbatim): `/tmp/claude-1000/-home-jesse-git-superpowers-superpowers/e58ccd70-08ca-4e00-9488-5c195d75e79e/scratchpad/verify-skill-discovery.sh` — a proven working script that performed real installs for 9 harnesses against the container image. Its per-harness commands, control runs, and traps are ground truth; its hardcoded `elements-of-style` names must be generalized.

**Interfaces:**
- Consumes: the mounted plugin at the path `run-checks.sh` already receives; generated files (`.claude-plugin/plugin.json`, `skills/*/SKILL.md`, `.pi/extensions/*.ts`, `.hermes-plugin/__init__.py`, `.agents/plugins/marketplace.json`).
- Produces: additional TAP lines named `install-<harness>`; same exit-code contract (3 on any failure).

**Requirements (all from issue #1 and the reference script):**

1. **Generalize names.** Plugin name: read from `.claude-plugin/plugin.json` `.name` via jq. Marketplace name for claude/codex/copilot installs: `<name>-dev` (that is what the emitted descriptor declares). Droid install id: `<name>@<basename-of-plugin-dir-copy>`. Skill names: every directory under the plugin's skills root that contains `SKILL.md` (derive the skills root the same way existing checks do). If the plugin has zero skills, every deep check emits `skip install-<harness>: plugin has no skills to verify` and the tier is a no-op.
2. **Writable copy.** Installs clone/copy out of the plugin dir; work from a writable copy (e.g. `cp -r` into a temp dir) and run opencode checks from a separate neutral directory, never from the plugin dir.
3. **Per-harness checks** (each gated on its CLI being on PATH, else `skip`):
   - `install-claude-code`: `claude plugin marketplace add <copy> && claude plugin install <name>@<name>-dev && claude plugin details <name>` lists every skill name.
   - `install-gemini`: write `{"security":{"folderTrust":{"enabled":false}}}` to `~/.gemini/settings.json` first (workspace-trust prompt prints nothing and hangs forever otherwise), then `gemini extensions install <copy> --consent` and `gemini skills list --all` lists every skill.
   - `install-codex`: `codex plugin marketplace add <copy> && codex plugin add <name>@<name>-dev && codex debug prompt-input` shows every skill (this proves the skill reaches the model-visible prompt).
   - `install-copilot`: `copilot plugin marketplace add <copy> && copilot plugin install <name>@<name>-dev && copilot skill list` lists every skill.
   - `install-opencode`: register the copy in `~/.config/opencode/opencode.json` (`{"plugin":["<copy>"]}`), then from the neutral dir: `opencode debug skill` must list the skills AND the control run `opencode debug skill --pure` must NOT — without the control the check proves nothing, because opencode auto-discovers `./skills` in the cwd.
   - `install-grok`: `grok plugin install <copy> --trust && grok plugin details <name>` reports ≥1 skill dir (`grep -E '[1-9][0-9]* skill dir'`).
   - `install-droid`: `droid plugin marketplace add <copy> && droid plugin install <name>@<copy-basename> && droid plugin list` shows the plugin, then every skill's `SKILL.md` exists under `~/.factory/plugins/cache`.
   - `install-hermes`: `hermes plugins install file://<copy> --enable`, `hermes plugins list --plain --no-bundled` shows the plugin; then execute the installed `.hermes-plugin/__init__.py`'s `register()` against a stub ctx (python3 heredoc, as in the reference script) asserting every skill name registers with an existing SKILL.md path — `hermes skills list` cannot enumerate plugin skills, which is why the stub is required. Skip (with that reason) if the plugin emits no `.hermes-plugin/`.
   - `install-pi`: run the emitted `.pi/extensions/<name>.ts` under bun with a stub `pi.on` recorder, invoke the recorded `resources_discover` handler, and assert its returned skill paths contain every skill (pi's real runtime needs auth). Skip if no `.pi/` emitted or bun absent. Note: the existing `check_pi` only type-checks/imports; this executes the discover hook — keep both.
   - `skip install-kimi`: TUI-only install; the verified-by-hand tmux procedure goes in a comment (from the reference script's trailer).
   - `skip install-cursor`: cursor-agent requires login before it will load a plugin.
   - `skip install-devin`: no devin CLI exists in the image.
4. **Tier placement:** deep checks run after the existing checks in the same script and share the same FAILED/exit-3 accounting. They are default-on: `everyharness test`'s whole purpose is proving the plugin works, and everything here is offline. No flag.
5. **Isolation:** installs mutate only the container-user's home (which is throwaway per `everyharness test` run). The script must not write into the mounted plugin dir.
6. **Docs:** update the README section describing `everyharness test` (and `src/test-command.ts`'s help text if it describes the checks) to say it now also performs real installs into each harness CLI and asserts skill enumeration.

- [ ] **Step 1: Write failing unit tests** for whatever is unit-testable outside docker: at minimum, run `checks/run-checks.sh` against `fixtures/kitchen-sink`'s generated output on the host and assert (a) deep-check lines appear for every harness (as `ok`/`skip`, never absent), (b) absent CLIs produce `skip`, (c) exit code stays within contract. Follow the pattern of the existing checks-script tests.
- [ ] **Step 2: Run to verify fail**
- [ ] **Step 3: Implement the deep-check tier in `checks/run-checks.sh`**, adapting the reference script. Preserve its inline comments explaining the opencode control run and the gemini folderTrust trap — those are load-bearing knowledge.
- [ ] **Step 4: Unit tests green; full `npm test` green**
- [ ] **Step 5: Live verification (required, not optional):** run `everyharness test` (or `scripts/`-equivalent) against a generated fixture plugin with the real `ghcr.io/prime-radiant-inc/everyharness-container` image (already in the local docker cache; check `docker images`). Every deep check must come back `ok` or a documented `skip` — paste the TAP output into your report.
- [ ] **Step 6: Commit** — `feat: everyharness test performs real installs and asserts skill enumeration (#1)`
