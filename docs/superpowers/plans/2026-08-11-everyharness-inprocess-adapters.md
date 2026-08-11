# everyharness In-Process Adapters + Generate-Mode Bootstrap Implementation Plan (Plan 3 of series)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three in-process adapters (OpenCode, Pi, Hermes), the `bootstrap.generate` mode, Gemini TOML command translation, and OpenCode command/agent translation — plus burn down the recorded Plan 3 backlog.

**Architecture:** Unchanged core. In-process adapters emit runtime code from parameterized templates (JS for OpenCode, TS for Pi, Python for Hermes), all modeled on superpowers' battle-tested implementations: module-level bootstrap caches, marker-based dedup guards, lifecycle gating, and (Hermes) the `Path()`-not-str gotcha. `bootstrap.generate` synthesizes a minimal bootstrap markdown file that every bootstrap-capable adapter consumes.

**Tech Stack:** unchanged (TypeScript strict ESM/NodeNext, commander/yaml/zod/ajv, vitest).

**Spec:** `docs/superpowers/specs/2026-08-10-everyharness-design.md`
**Ground truth:** superpowers@dev `.opencode/plugins/superpowers.js`, `.pi/extensions/superpowers.ts`, `.hermes-plugin/{plugin.yaml,__init__.py}`, root package.json `main`/`pi` fields (researched 2026-08-11); opencode.ai/docs/commands + /agents; gemini-cli docs/cli/custom-commands + docs/extensions/reference; developers.openai.com/codex (custom prompts deprecated, no plugin-shipped prompts — plugin components are skills/MCP/hooks only).

## Global Constraints

- Node `>=20`, ESM, TS strict, `.js` relative imports. Runtime deps stay exactly: `commander`, `yaml`, `zod`, `ajv`.
- Exit codes unchanged. No silent drops. Generated-file markers: `//` comment line 2 for JS/TS, `#` line 2 for Python/bash (line 1 shebang where applicable), `<!-- ... -->` line 1 for markdown WITHOUT frontmatter; for frontmattered markdown (opencode command/agent files) the marker is a `# ...` YAML comment INSIDE the frontmatter block — a leading HTML comment would break frontmatter parsers, which require `---` on line 1 (correction discovered during Task 3). `# ...` line 1 for TOML and YAML. JSON marker-free.
- Emitted runtime code must be self-contained (no imports beyond node builtins / the harness's own API package) and must never hard-code the plugin name where a template parameter exists.
- In-process templates keep superpowers' proven mechanics: module-level tri-state bootstrap cache; content-marker dedup guard (`<plugin-bootstrap plugin="NAME">` as the marker); OpenCode injects into the first USER message (not system); Pi splices after leading `compactionSummary` messages and re-arms on `session_start`/`session_compact`, disarms on `agent_end`; Hermes registers skills with `Path(...)` (str silently disables the plugin) and injects via `pre_llm_call` + `is_first_turn`.
- TDD; pristine output.

## Design decisions locked by this plan

1. **`bootstrap.generate` mode** emits `hooks/everyharness/bootstrap.md` (markdown, marker line 1): a `# <name> plugin` heading, one line `Invoke the relevant skill BEFORE acting when a task matches its description.`, then a bullet list `- **<skill-name>**: <description>` for every skill. All bootstrap-capable adapters consume this file the same way they consume a bootstrap skill's SKILL.md in skill mode (shell hook cats it; GEMINI.md @-includes it; in-process templates read it). Adapters that need a named skill (kimi's `sessionStart.skill`) warn in generate mode: `kimi sessionStart requires a named bootstrap skill; generate mode is not supported on kimi`.
2. **Source-guard refinement** (needed for Gemini TOML): `isSourcePath` blocks — `everyharness.yaml`, the exact hooks/mcp file paths, ANY path under the skills dir, and paths under the commands/agents dirs ONLY when they end in `.md` (the source format). This lets adapters emit non-`.md` siblings (e.g. `commands/<name>.toml`) into those dirs without ever being able to clobber a source file. The clobber-refusal guard (Plan 2) still protects pre-existing user files of any type.
3. **Root `package.json` ownership (OpenCode + Pi):** both adapters emit an IDENTICAL generated root `package.json` via one shared builder — `{ name, version, description, type: 'module', main: './.opencode/plugins/<name>.js', pi: { extensions: ['./.pi/extensions/<name>.ts'], skills: ['./<skillsdir>'] }, keywords: [...(config.keywords ?? []), 'pi-package'] }` — so the Plan 2 dedupe collapses them. The file always carries both harnesses' fields even if one adapter is excluded (documented in the builder's comment; a dangling `main` is harmless when OpenCode isn't in use). If the plugin root already has a user `package.json`, the Plan 2 clobber-refusal fires — the error message tells the user to either remove it, exclude opencode+pi, or move its contents into overrides (this is the honest v1 behavior; merging user package.json is future work recorded in this plan's backlog-out section).
4. **Codex commands warning corrected:** research shows Codex deprecated custom prompts and plugins cannot ship them. The codex warning becomes `commands are not supported on codex (no plugin-shipped prompt mechanism)` — dropping the false "land in Plan 3" promise. Plan 2's doc line stands as written history; the support matrix stays `commands: 'none'` permanently for codex.
5. **OpenCode command/agent translation is format-compatible passthrough:** Claude command `.md` (frontmatter `description`, body with `$ARGUMENTS`) → `.opencode/command/<name>.md` with frontmatter `description` only (body verbatim — `$ARGUMENTS`/`$1` syntax is compatible). Claude agent `.md` (frontmatter `name`/`description`/`tools`) → `.opencode/agent/<name>.md` with frontmatter `description` + `mode: subagent` (body verbatim; `tools` NOT translated — permission models differ; warn once per plugin when any agent has a `tools` field: `agent tool restrictions are not translated for opencode`). Singular `command`/`agent` dirs (opencode's own convention).
6. **Gemini TOML commands:** `commands/<name>.toml` at plugin root (extension root = plugin root; nesting not used in v1). Content: marker comment line, `description = "<description>"` when present, `prompt = """<body with $ARGUMENTS replaced by {{args}}>"""`. `$1`/`$2` positionals have no Gemini equivalent → per-command warning `command "<name>" uses positional arguments; Gemini supports only {{args}} — positional syntax passed through verbatim` (body still emitted, `$ARGUMENTS` still swapped). Triple-quote safety: if the body contains `"""`, emit the command with the sequence escaped per TOML (`\"\"\"` inside a basic multiline string) — or simpler and robust: emit `prompt` as a TOML multi-line literal with the body's `"""` occurrences replaced by `""\"` and a warning; bodies containing `"""` are vanishingly rare, warn `command "<name>" body contains triple quotes; escaped for TOML`.

## Backlog burn-down (from Plan 2 whole-branch review — Task 1 of this plan)

In scope: gemini `contextFileName` override mismatch warning; gemini.ts uses shared `json`; old-default `mcp.json` upgrade warning; print pruned paths; agent-plugins malformed-`mcpServers` warning; cursor positive-override + generate-mode tests; kimi bootstrap-none test; ConfigError `cause` chaining; model.ts agents sorted by final (frontmatter) name; model.ts description-extraction helper.
Explicitly NOT in this plan (remain recorded): hook double-fire EMPIRICAL CHECK (needs a live Claude Code session — Plan 4 alongside the dogfood test); `.gitattributes`/CRLF install-docs note (Plan 4, docs generation); prune-before-write window (accepted residual — regenerable by definition); codex-vs-devin matrix wording (Plan 4 matrix docs); agent-plugins translate-time element typing (validate() catches invalid output; revisit only if it bites); user-package.json merging (recorded here, future); PRE-EXISTING BUG found during Task 1: explicit `components.mcp: mcp.json` + agent-plugins-1.0 makes generate() throw unconditionally (adapter emits hardcoded `mcp.json` = the source path) — fix candidates: adapter skips emission with a warning when the source occupies mcp.json, or emits nothing and relies on the skills-dir-style warning (Plan 4); hermes _skills_dir probes isdir only (stale-empty-dir could win over populated flattened layout); $-digit positional detection can false-positive on dollar amounts; TOML description field would break on embedded raw newlines (spec gap).

## File Structure (this plan)

```
src/
  config.ts                # modify: (no schema change; cause chaining in ConfigError)
  model.ts                 # modify: agents final-name sort, description helper, mcp old-default warning source? (no—warning lives in generate)
  generate.ts              # modify: isSourcePath refinement, old-mcp warning, pruned paths print (cli)
  bootstrap/
    generated.ts           # new: generatedBootstrap(model) → markdown content
    shell-hook.ts          # modify: sessionStartScript takes bootstrapContentPath (skill SKILL.md or generated bootstrap.md)
    node-package.ts        # new: nodePackageManifest(model) shared by opencode+pi
    templates/             # new: opencode-plugin.js.tmpl, pi-extension.ts.tmpl, hermes-init.py.tmpl as exported string constants in one ts file each (opencode.ts, pi.ts, hermes.ts) — placeholders __PLUGIN_NAME__, __SKILLS_DIR__, __BOOTSTRAP_PATH__
  adapters/
    opencode.ts            # new
    pi.ts                  # new
    hermes.ts              # new
    gemini.ts              # modify: TOML commands, contextFileName warning, shared json
    codex.ts               # modify: warning text
    claude-code.ts, cursor.ts, kimi.ts  # modify: generate-mode consumes bootstrap.md
    index.ts               # modify: register opencode, pi, hermes
tests/
  bootstrap-generated.test.ts, adapters/{opencode,pi,hermes}.test.ts  # new
  (modifications across existing suites per task)
```

---

### Task 1: Backlog burn-down

**Files:**
- Modify: `src/config.ts`, `src/model.ts`, `src/generate.ts`, `src/cli.ts`, `src/adapters/gemini.ts`, `src/adapters/agent-plugins.ts`
- Test: touched suites

**Interfaces:** all behavior-preserving except the enumerated additions:

1. `ConfigError` gains `cause` support: constructor `(message, details?, opts?: { cause?: unknown })`, passing `{ cause }` to `super` — wire it at the YAML-parse throw in `loadConfig` and the JSON throws in `manifest.ts`/`model.ts`. Test: caught error's `.cause` is the original SyntaxError for a bad-YAML config.
2. `src/model.ts`: agents sorted by FINAL name (after frontmatter override) — sort the mapped array, not the pre-map listing. Test: temp fixture with `zz.md` whose frontmatter name is `aaa` and `bb.md` with no name → order `['aaa','bb']`.
3. `src/model.ts`: extract `stringOr(data, key): string | undefined` helper replacing the duplicated description ternaries (pure refactor; suite green unchanged).
4. `src/generate.ts`: when no prior manifest lists it and `components.mcp === '.mcp.json'` (default) and root `mcp.json` EXISTS as a plain file not in the new FileSet's source set → warning `found mcp.json at the plugin root; the source MCP default is .mcp.json — rename it if it is your MCP config`. (Guard: skip when config explicitly sets components.mcp to 'mcp.json'.) Test: fixture copy with stray root mcp.json → warning present.
5. `src/cli.ts`: pruned paths printed one per line (`pruned: <path>`) before the count line. Test: cli e2e or unit via generate result — extend the existing prune test to assert stdout lines (unit-level acceptable: assert result.pruned then keep cli change trivial).
6. `src/adapters/gemini.ts`: use shared `json` from shared.ts; warn when `overrides.gemini.contextFileName` is set and ≠ 'GEMINI.md': `contextFileName override "<v>" does not match the emitted GEMINI.md; the harness will look for a missing file`. Tests for both.
7. `src/adapters/agent-plugins.ts`: malformed `mcpServers` (model.mcp exists but mcpServers missing/non-object) → warning `mcp config has no mcpServers object; nothing translated for agent-plugins-1.0` (no mcp.json emitted). Test with synthetic fixture.
8. `tests/adapters/cursor.test.ts`: positive `overrides.cursor.displayName` test + generate-mode test (warning + no hook files). `tests/adapters/kimi.test.ts`: bootstrap-none test (no sessionStart key, no warning).

Steps: write all failing/new tests → RED where behavior changes → implement → GREEN → full suite + tsc → commit `fix: burn down Plan 2 review backlog`.

---

### Task 2: Generated bootstrap + source-guard refinement

**Files:**
- Create: `src/bootstrap/generated.ts`
- Modify: `src/bootstrap/shell-hook.ts`, `src/generate.ts`, `src/adapters/{claude-code,cursor,gemini,kimi}.ts`
- Test: `tests/bootstrap-generated.test.ts` + touched adapter suites

**Interfaces:**
- `generatedBootstrap(model: PluginModel): string` — exactly:
  ```
  <!-- GENERATED by everyharness — edit everyharness.yaml instead -->
  # <name> plugin

  Invoke the relevant skill BEFORE acting when a task matches its description.

  - **<skill-name>**: <description>
  (one bullet per skill, model.skills order)
  ```
- `sessionStartScript(opts: { pluginName: string; bootstrapContentPath: string })` — RENAMED param (was bootstrapSkillDir): now takes the full repo-relative path of the markdown file to cat (`skills/<x>/SKILL.md` in skill mode, `hooks/everyharness/bootstrap.md` in generate mode). Callers updated. Template placeholder becomes `__BOOTSTRAP_PATH__` (cat `${PLUGIN_ROOT}/__BOOTSTRAP_PATH__`).
- Adapters, generate mode (replacing the warn-and-fallback): claude-code and cursor emit `hooks/everyharness/bootstrap.md` (both — dedupe collapses) + their hook files wired to it; gemini @-includes `@./hooks/everyharness/bootstrap.md`; kimi warns `kimi sessionStart requires a named bootstrap skill; generate mode is not supported on kimi` (no sessionStart key). The old `bootstrap.generate is not implemented until Plan 3; falling back to none` warning is deleted everywhere.
- `isSourcePath` refinement per Design decision 2 (with tests: emitting `commands/x.toml` allowed; `commands/x.md` blocked; `skills/anything` still blocked).

Steps: TDD (bootstrap-generated tests: exact content for kitchen-sink; script-execution test rerun for a generate-mode fixture — execute the emitted session-start against a synthetic plugin with bootstrap.generate and two skills, assert JSON contains the bullet list; adapter-mode tests updated) → implement → GREEN → snapshot -u reviewed → full suite + tsc → commit `feat: bootstrap.generate mode with shared generated bootstrap file`.

---

### Task 3: OpenCode adapter

**Files:**
- Create: `src/adapters/opencode.ts`, `src/bootstrap/node-package.ts`
- Modify: `src/adapters/index.ts`
- Test: `tests/adapters/opencode.test.ts`

**Interfaces:**
- `nodePackageManifest(model): Record<string, unknown>` (in node-package.ts, shared with Task 4): per Design decision 3.
- Adapter `opencode` emits:
  - Root `package.json` via nodePackageManifest (JSON, dedupe-identical with pi's).
  - `.opencode/plugins/<name>.js` from a template string constant modeled directly on superpowers' plugin (same mechanics, generic naming): module-level tri-state `_bootstrapCache`; `extractAndStripFrontmatter` (only needed in skill mode — generate mode's file has no frontmatter; stripping is harmless, keep it unconditional); `config` hook pushing the plugin's own skills dir (`path.resolve(__dirname, '../../<skillsdir>')`) into `config.skills.paths` idempotently; `'experimental.chat.messages.transform'` hook injecting `<plugin-bootstrap plugin="__PLUGIN_NAME__">\n...content...\n</plugin-bootstrap>` as a leading text part on the first user message, guarded by `p.text.includes('<plugin-bootstrap plugin="__PLUGIN_NAME__">')`. Bootstrap file path: `__BOOTSTRAP_PATH__` (skill SKILL.md or bootstrap.md; in `bootstrap: none` mode the transform hook and cache are OMITTED from the emitted file — config-hook-only plugin). Export name `EveryharnessPlugin_<safeName>`? No — OpenCode looks for any exported plugin function; use `export const Plugin = async ({ client, directory }) => {...}`; keep superpowers' shape (`export const <PascalName>Plugin`) with PascalCase of the plugin name, placeholder `__PASCAL_NAME__`.
  - Commands → `.opencode/command/<name>.md`: marker line 1 (HTML comment), then frontmatter with `description` (when present), body verbatim from the source command's body.
  - Agents → `.opencode/agent/<name>.md`: marker, frontmatter `description` + `mode: subagent`, body verbatim; plugin-level warning when any source agent has `tools` frontmatter: `agent tool restrictions are not translated for opencode`.
  - Warnings: hooks present → `hooks are not emitted for opencode`; mcp present → `mcp servers are not emitted for opencode in v1`.
  - Support: `{skills:'full', commands:'full', agents:'partial', hooks:'none', mcp:'none', bootstrap:'full'}` (agents partial: tools dropped).
- Model/command source access: commands/agents need BODIES — `CommandRef`/`AgentRef` carry only name/path/description. Extend `buildModel` to include `body: string` on both (read at model build; additive fields, existing tests unaffected).

Steps: TDD — tests: exact package.json; emitted JS contains no leftover `__…__` placeholders, contains the marker guard string and skills-dir registration; a NODE EXECUTION test: `node --input-type=module -e "import('<emitted file>').then(m => …)"` — actually simpler and meaningful: write the emitted plugin JS to a temp dir mimicking the layout (with skills + bootstrap file), import it dynamically in vitest (dynamic `import()` of a file URL), call the exported factory with `{client:null, directory:''}`, run the returned `config` hook against `{skills:{paths:[]}}` and assert the path got pushed; call the transform hook with a fake messages array and assert exactly-once injection (twice-called → still one bootstrap part). Command/agent translation exact-content tests. RED → implement → GREEN → snapshot -u → full + tsc → commit `feat: opencode adapter with runtime plugin, command and agent translation`.

---

### Task 4: Pi adapter

**Files:**
- Create: `src/adapters/pi.ts`
- Modify: `src/adapters/index.ts`
- Test: `tests/adapters/pi.test.ts`

**Interfaces:**
- Adapter `pi` emits: root `package.json` (nodePackageManifest — identical to opencode's, dedupe) and `.pi/extensions/<name>.ts` from a template modeled on superpowers' extension: `BOOTSTRAP_MARKER = '<plugin-bootstrap plugin="__PLUGIN_NAME__">'` (marker doubles as wrapper open-tag); `resources_discover` returning `{ skillPaths: [<resolved skillsdir>] }`; `session_start`/`session_compact` arm + `agent_end` disarm; `context` handler with `messageContainsBootstrap` + `firstNonCompactionSummaryIndex` splice (transcribe superpowers' logic, genericized); module-level `cachedBootstrap` reading `__BOOTSTRAP_PATH__`. In `bootstrap: none` mode: emit only `resources_discover` (no context handler). Tool-mapping section: NOT emitted (that's plugin-specific content; overrides can't inject into a TS file — document in module comment that plugins wanting a tool-mapping section should put it in their bootstrap skill).
- Warnings: commands → `commands are not emitted for pi`; agents → `agents are not emitted for pi`; hooks → `hooks are not emitted for pi`; mcp → `mcp servers are not emitted for pi`.
- Support: `{skills:'full', commands:'none', agents:'none', hooks:'none', mcp:'none', bootstrap:'full'}`.

Steps: TDD — tests: no leftover placeholders; emitted TS contains the four `pi.on(` registrations in skill mode and only `resources_discover` in none mode; package.json byte-identical to opencode's emission (direct compare across adapters — the dedupe contract); TYPE-CHECK the emitted TS: write to temp, run `npx tsc --noEmit --strict --module nodenext` against it with a stub `@earendil-works/pi-coding-agent` types file (write a minimal `.d.ts` stub in the temp dir + tsconfig paths mapping; if stubbing fights tsc, fall back to asserting structural content and note it in the report). RED → implement → GREEN → snapshot -u → full + tsc → commit `feat: pi adapter with runtime extension`.

---

### Task 5: Hermes adapter

**Files:**
- Create: `src/adapters/hermes.ts`
- Modify: `src/adapters/index.ts`
- Test: `tests/adapters/hermes.test.ts`

**Interfaces:**
- Adapter `hermes` emits:
  - `.hermes-plugin/plugin.yaml`: marker comment line 1, then `name`, `version`, `description`, `author: <author.name>` (when set), `provides_hooks:\n  - pre_llm_call` (only when bootstrap active; omit the key entirely in none mode).
  - `.hermes-plugin/__init__.py`: template modeled on superpowers': `BOOTSTRAP_MARKER = '<plugin-bootstrap plugin="__PLUGIN_NAME__">'`; `_skills_dir()` with the two-layout candidates (`../<skillsdir>`, `./<skillsdir>`) raising RuntimeError loudly; `_strip_frontmatter`; `_build_bootstrap` reading `__BOOTSTRAP_REL__` (path relative to the skills-dir parent — careful: superpowers reads the bootstrap skill from inside skills_dir; in generate mode the bootstrap.md lives at hooks/everyharness/bootstrap.md relative to plugin root, so `_build_bootstrap` takes the plugin root = dirname of skills_dir... simplest correct: template resolves `plugin_root = os.path.dirname(skills_dir) if skills_dir ends with /<skillsdir> else here`, then reads `os.path.join(plugin_root, "__BOOTSTRAP_PATH__")`); `register(ctx)` iterating skills dir calling `ctx.register_skill(name, Path(skill_md))` (Path — the str gotcha goes in a comment verbatim); `pre_llm_call` returning `{"context": bootstrap}` on `is_first_turn` (only registered when bootstrap active).
  - Warnings: commands/agents/hooks/mcp → `<component> are not emitted for hermes` (mcp: `mcp servers are not emitted for hermes`).
  - Support: `{skills:'full', commands:'none', agents:'none', hooks:'none', mcp:'none', bootstrap:'full'}`.
- PYTHON SYNTAX CHECK test: write emitted `__init__.py` to temp, run `python3 -m py_compile <file>` via execFileSync — must exit 0 (python3 is available). Plus placeholder-absence and structural assertions (Path( usage, BOOTSTRAP_MARKER, is_first_turn gate). YAML parse test on plugin.yaml.

Steps: TDD → implement → GREEN → snapshot -u → full + tsc → commit `feat: hermes adapter with python plugin`.

---

### Task 6: Gemini TOML command translation

**Files:**
- Modify: `src/adapters/gemini.ts`
- Test: `tests/adapters/gemini.test.ts`

**Interfaces:** per Design decision 6. Emitted per source command: `commands/<name>.toml` with marker line, optional `description = "<escaped>"` (TOML basic-string escaping for `"` and `\`), `prompt = """\n<body with $ARGUMENTS → {{args}}>\n"""`. Warnings per decision 6 for positionals and embedded triple quotes. The commands warning (`commands are not translated to Gemini TOML in v1 (Plan 3)`) is REMOVED; support.commands → 'full'. Requires Task 2's source-guard refinement (emitting .toml under commands/) and Task 3's `CommandRef.body`.

Steps: TDD — kitchen-sink ks-hello exact TOML content; positional-args fixture warning; description-escaping test (`say "hi"` in description); RED → implement → GREEN → snapshot -u → full + tsc → commit `feat: gemini TOML command translation`.

---

### Task 7: E2E, matrix, docs, v0.3.0

**Files:**
- Modify: `tests/cli.test.ts`, `README.md`, `src/generate.ts` (TOOL_VERSION), `package.json`

**Interfaces:** registry now 11 adapters. cli e2e: generate reports 11 harness(es) with all names; validate clean; matrix 11 rows; second-generate idempotent. README status line becomes: `**Current status: generation works for all 12+ target harnesses — Claude Code, Cursor, Codex, Devin, Kimi, Gemini (incl. TOML commands), OpenCode (incl. commands/agents), Pi, Hermes, Agent Plugins 1.0, and the .agents marketplace descriptor (Droid/Grok/Copilot). Remaining before v1: init/import, generated install docs, superpowers dogfood test, container-based install testing.**` WIP banner first sentence updated to match (`Eleven harness adapters exist today...` — keep the rest). TOOL_VERSION + package.json → 0.3.0 (lockfile synced).

Steps: assertions updated → verify → manual CLI capture (generate/validate/matrix on temp kitchen-sink; the refusal/--force flow retested since package.json is now generated: a fixture with pre-existing user package.json → refusal message) → commit `chore: v0.3.0 — eleven adapters, generate-mode bootstrap, command translation`.

---

## Self-Review Notes

- **Coverage:** roadmap items (OpenCode/Pi/Hermes, bootstrap.generate, Gemini TOML) all tasked; recorded backlog fully triaged (Task 1 in-scope list + explicit stays-recorded list); codex prompts promise corrected per research (decision 4). Deferred with owners: hook double-fire empirical check + CRLF note + matrix docs → Plan 4; user-package.json merge → recorded in decision 3.
- **Type consistency:** `CommandRef.body`/`AgentRef.body` added in Task 3 and consumed by Tasks 3 (opencode) and 6 (gemini) — Task 6 lists the dependency; `nodePackageManifest` shared by Tasks 3/4; `sessionStartScript` param rename ripples through claude-code/cursor in Task 2 only.
- **Judgment calls:** package.json dual-field emission with dedupe (decision 3) documented; pi/hermes tool-mapping deliberately not generated (plugin-specific content); emitted-code verification is executable where cheap (dynamic import for JS, py_compile for Python, tsc-with-stub best-effort for TS).
