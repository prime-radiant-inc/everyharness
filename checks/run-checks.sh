#!/usr/bin/env bash
# checks/run-checks.sh — container-backed offline install checks for a
# generated everyharness plugin.
#
# Ships with the everyharness npm package (see package.json "files") and is
# bind-mounted read-only at /checks by `everyharness test`
# (src/test-command.ts), which also mounts the generated plugin read-only at
# /plugin and sets EH_PLUGIN_NAME to the plugin's name from
# everyharness.yaml. Runs in two tiers, both fully offline — never invokes an
# LLM, needs no API keys or network access:
#   1. Shallow checks: each harness's cheapest "does this actually
#      load/parse" check against the mounted plugin (manifests parse,
#      referenced paths exist).
#   2. Deep install-verification checks (install-<harness>): a REAL install of
#      the plugin into each harness CLI present, then an assertion that the CLI
#      actually enumerates the plugin's skills. See the deep tier below.
#
# Set EH_PLUGIN_ROOT to point at a different plugin root (default: /plugin).
# This is only for local development — it lets this script be unit-tested
# directly against a generated fixture without a container; the real
# `everyharness test` invocation always mounts at /plugin and relies on the
# default.
#
# Output is TAP-ish: one line per check (deep-tier lines are named
# install-<harness>) —
#   ok <name>: <what passed>
#   not ok <name>: <what failed>
#   skip <name>: <why it was skipped (not generated, CLI unavailable)>
# Exit status: 0 if no "not ok" line was printed, else 3 — a distinctive
# code chosen so it can't collide with docker's own generic exit 1 (e.g.
# daemon down, no socket perms), which src/test-command.ts must tell apart
# from a real check failure.
set -u

: "${EH_PLUGIN_NAME:?EH_PLUGIN_NAME must be set}"
PLUGIN_ROOT="${EH_PLUGIN_ROOT:-/plugin}"

FAILED=0

ok() {
  printf 'ok %s: %s\n' "$1" "$2"
}

not_ok() {
  printf 'not ok %s: %s\n' "$1" "$2"
  FAILED=1
}

skip() {
  printf 'skip %s: %s\n' "$1" "$2"
}

# Collapses a (possibly multi-line) command-error blob into one line and
# truncates to 300 chars. Single-line output stays grep-able, and truncation
# prevents deep-check captures (which can be tens of KB: full opencode/codex
# dumps on failure) from bloating the output. 300 chars is enough for the head
# of a stack trace or parse error, which is what callers need.
oneline() {
  printf '%s' "$1" | tr '\n' ' ' | cut -c1-300
}

# The marketplace name the deep-tier installs address a plugin by: claude/
# codex/copilot install ids are `<plugin>@<marketplace-name>`, and that name is
# the descriptor's own declared `.name` — which is now configurable
# (marketplace.name), so it can no longer be assumed to be `<plugin>-dev`. Read
# it from the emitted descriptor ($1), falling back to the local-dev default
# ($2) when the file is absent or unparseable.
market_name() {
  local descriptor="$1" fallback="$2" name
  name=$(jq -r '.name // empty' "$descriptor" 2>/dev/null)
  if [ -n "$name" ]; then
    printf '%s' "$name"
  else
    printf '%s' "$fallback"
  fi
}

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

# True (0) only if EVERY one of the plugin's skills (SKILL_NAMES, set by
# deep_checks) appears somewhere in the given output blob — used to assert a
# harness enumerated the whole set after a real install.
all_skills_present() {
  local out="$1" name
  for name in "${SKILL_NAMES[@]}"; do
    grep -qF -- "$name" <<<"$out" || return 1
  done
  return 0
}

# True (0) if ANY of the plugin's skills appears in the blob — used for
# opencode's --pure control run, which must surface none of them.
any_skill_present() {
  local out="$1" name
  for name in "${SKILL_NAMES[@]}"; do
    grep -qF -- "$name" <<<"$out" && return 0
  done
  return 1
}

# --- claude-code: `claude plugin validate --strict /plugin` -----------------
# The dev marketplace descriptor (.claude-plugin/marketplace.json) self-
# references the plugin manifest via `source: "./"`, so validating the
# plugin root exercises both generated files in one pass.
check_claude_code() {
  local harness=claude-code
  local manifest="$PLUGIN_ROOT/.claude-plugin/plugin.json"
  if [ ! -f "$manifest" ]; then
    skip "$harness" "not generated"
    return
  fi
  if ! command -v claude >/dev/null 2>&1; then
    skip "$harness" "claude binary not present"
    return
  fi
  local out
  if out=$(claude plugin validate --strict "$PLUGIN_ROOT" 2>&1); then
    ok "$harness" "claude plugin validate --strict passed"
  else
    not_ok "$harness" "claude plugin validate --strict failed: $(oneline "$out")"
  fi
}

# --- opencode: structural node import of the emitted plugin module ---------
check_opencode() {
  local harness=opencode
  local file="$PLUGIN_ROOT/.opencode/plugins/${EH_PLUGIN_NAME}.js"
  if [ ! -f "$file" ]; then
    skip "$harness" "not generated"
    return
  fi
  local out
  if out=$(node --input-type=module -e "import('$file')" 2>&1); then
    ok "$harness" "node import of .opencode/plugins/${EH_PLUGIN_NAME}.js succeeded"
  else
    not_ok "$harness" "node import of .opencode/plugins/${EH_PLUGIN_NAME}.js failed: $(oneline "$out")"
  fi
}

# --- pi: bun import of the emitted extension, with a file-presence fallback
# `import type` erases at bun's runtime type-stripping, so the extension
# imports cleanly without the (uninstalled) pi package present. The fallback
# covers ONLY bun's absence; a present-but-failing import is a real failure.
check_pi() {
  local harness=pi
  local file="$PLUGIN_ROOT/.pi/extensions/${EH_PLUGIN_NAME}.ts"
  if [ ! -f "$file" ]; then
    skip "$harness" "not generated"
    return
  fi
  if ! command -v bun >/dev/null 2>&1; then
    ok "$harness" ".pi/extensions/${EH_PLUGIN_NAME}.ts present (FALLBACK-file-presence: bun not installed)"
    return
  fi
  local out
  if out=$(bun -e "await import('$file')" 2>&1); then
    ok "$harness" "bun import of .pi/extensions/${EH_PLUGIN_NAME}.ts succeeded"
  else
    not_ok "$harness" "bun import of .pi/extensions/${EH_PLUGIN_NAME}.ts failed: $(oneline "$out")"
  fi
}

# --- hermes: python3 ast.parse of the emitted plugin module ----------------
check_hermes() {
  local harness=hermes
  local file="$PLUGIN_ROOT/.hermes-plugin/__init__.py"
  if [ ! -f "$file" ]; then
    skip "$harness" "not generated"
    return
  fi
  local out
  if out=$(python3 -c "import ast, sys; ast.parse(open(sys.argv[1]).read())" "$file" 2>&1); then
    ok "$harness" "python3 ast.parse of .hermes-plugin/__init__.py succeeded"
  else
    not_ok "$harness" "python3 ast.parse of .hermes-plugin/__init__.py failed: $(oneline "$out")"
  fi
}

# --- gemini: `gemini extensions validate` when offered, else jq + paths ----
check_gemini() {
  local harness=gemini
  local file="$PLUGIN_ROOT/gemini-extension.json"
  if [ ! -f "$file" ]; then
    skip "$harness" "not generated"
    return
  fi
  if command -v gemini >/dev/null 2>&1 && gemini extensions --help 2>/dev/null | grep -q validate; then
    local out
    if out=$(gemini extensions validate "$PLUGIN_ROOT" 2>&1); then
      ok "$harness" "gemini extensions validate passed"
    else
      not_ok "$harness" "gemini extensions validate failed: $(oneline "$out")"
    fi
    return
  fi
  check_manifest_harness "$harness" "gemini-extension.json"
}

# --- manifest harnesses: jq-parse + referenced-path existence --------------
# Shared by codex/cursor/devin/kimi/agent-plugins-1.0/agents-marketplace
# (each own a fixed-path manifest with no per-plugin-name substitution) and
# by gemini's fallback above. A referenced path is any string value in the
# manifest (at any depth) that starts with "./" — everyharness's own
# convention for every path-shaped field it emits (e.g. "./skills/"); such a
# path is always relative to the plugin root, regardless of which
# subdirectory the manifest itself lives in.
#
# mcp.json's top-level mcpServers is excluded from the scan: its
# command/args/cwd are subprocess invocation parameters carried through
# verbatim from the source MCP config, not plugin-structure path references
# (a "./"-prefixed arg is just an opaque token passed to the server command;
# kitchen-sink's own fixture ships one, "./mcp-demo-server.js", that has
# never existed on disk — it exists only to prove the translation preserves
# args byte-for-byte).
check_manifest_harness() {
  local harness="$1" relpath="$2"
  local file="$PLUGIN_ROOT/$relpath"
  if [ ! -f "$file" ]; then
    skip "$harness" "$relpath not generated"
    return
  fi
  local err
  if ! err=$(jq empty "$file" 2>&1); then
    not_ok "$harness" "$relpath is not valid JSON: $(oneline "$err")"
    return
  fi
  local missing=()
  local ref
  while IFS= read -r ref; do
    [ -z "$ref" ] && continue
    [ -e "$PLUGIN_ROOT/$ref" ] || missing+=("$ref")
  done < <(jq -r 'del(.mcpServers) | [.. | strings | select(startswith("./"))] | .[]' "$file")
  if [ "${#missing[@]}" -gt 0 ]; then
    not_ok "$harness" "$relpath references missing path(s): ${missing[*]}"
  else
    ok "$harness" "$relpath parses and referenced paths exist"
  fi
}

# ============================================================================
# Deep install-verification tier
# ============================================================================
# Everything above proves the generated manifests parse and their referenced
# paths exist. This tier goes a level deeper: it performs a REAL install of
# the plugin into each harness CLI that is present, then asserts the CLI
# actually ENUMERATES the plugin's skills — the question that catches a
# manifest that is valid but wired to the wrong place.
#
# These installs mutate only $HOME (marketplaces, caches, settings), never the
# mounted plugin dir: each installer runs against a writable COPY of the
# plugin, and several of them (codex, droid, hermes) install by CLONING it, so
# the copy is made a throwaway git repo. `everyharness test` always runs this
# inside the container, whose $HOME is discarded per run. A check whose CLI is
# absent from PATH emits `skip`, never `not ok`, so the script stays runnable
# on a dev host outside the container (which is how the unit tests exercise it).

# claude-code and copilot install THROUGH the emitted .claude-plugin
# descriptor; deep_checks() rewrites its entry source to the local "./" form
# in the throwaway $WORK copy (rewrite_market_source_local, above) before
# these run, so a repository/http-sourced descriptor installs offline instead
# of needing a network clone. deep_claude_code/deep_copilot skip (never fail)
# only when that rewrite itself failed — MARKET_REWRITE_OK is 0 only for a
# malformed marketplace.json, which still deserves a report rather than a
# silent pass. Other harnesses install through their own descriptors (codex:
# .agents/plugins/marketplace.json, always local) or a direct path, so
# they're unaffected.

# --- install-claude-code: install from the emitted dev marketplace, then read
# the component inventory the CLI itself reports.
deep_claude_code() {
  local harness=install-claude-code
  if ! command -v claude >/dev/null 2>&1; then
    skip "$harness" "claude not on PATH"
    return
  fi
  [ "$MARKET_REWRITE_OK" = 1 ] || { skip "$harness" "marketplace.json could not be rewritten for offline install (malformed descriptor)"; return; }
  local out
  out=$(cd "$WORK" && claude plugin marketplace add "$WORK" >/dev/null 2>&1 &&
        claude plugin install "${PLUGIN_NAME}@${MARKET}" >/dev/null 2>&1 &&
        claude plugin details "$PLUGIN_NAME" 2>&1)
  if all_skills_present "$out"; then
    ok "$harness" "claude plugin details enumerates all ${#SKILL_NAMES[@]} skill(s) after a real install"
  else
    not_ok "$harness" "claude plugin details did not enumerate every skill: $(oneline "$out")"
  fi
}

# --- install-gemini: two separate prompts have to be defused or the install
# blocks forever. --consent covers the third-party-extension warning;
# folderTrust must be disabled in settings.json to cover the workspace-trust
# prompt, which --consent does NOT cover and which prints nothing while it
# waits.
deep_gemini() {
  local harness=install-gemini
  if ! command -v gemini >/dev/null 2>&1; then
    skip "$harness" "gemini not on PATH"
    return
  fi
  mkdir -p "$HOME/.gemini"
  printf '{"security":{"folderTrust":{"enabled":false}}}' > "$HOME/.gemini/settings.json"
  local out
  out=$(gemini extensions install "$WORK" --consent >/dev/null 2>&1 &&
        gemini skills list --all 2>&1)
  if all_skills_present "$out"; then
    ok "$harness" "gemini skills list --all shows every skill after install"
  else
    not_ok "$harness" "gemini skills list --all did not show every skill: $(oneline "$out")"
  fi
}

# --- install-codex: `debug prompt-input` renders the model-visible prompt, so
# a hit here proves the skill reaches the model rather than merely sitting on
# disk. codex installs through the Agent Plugins descriptor (.agents/plugins/
# marketplace.json), so its install id uses CODEX_MARKET (that descriptor's
# name), not MARKET. That descriptor's entry source is always the local
# `{source:url,url:"./"}` regardless of the marketplace.source config, so codex
# is inherently offline-installable and takes no non-local-source skip.
deep_codex() {
  local harness=install-codex
  if ! command -v codex >/dev/null 2>&1; then
    skip "$harness" "codex not on PATH"
    return
  fi
  local out
  out=$(cd "$WORK" && codex plugin marketplace add "$WORK" >/dev/null 2>&1 &&
        codex plugin add "${PLUGIN_NAME}@${CODEX_MARKET}" >/dev/null 2>&1 &&
        codex debug prompt-input 2>&1)
  if all_skills_present "$out"; then
    ok "$harness" "every skill appears in codex's model-visible prompt"
  else
    not_ok "$harness" "skill(s) absent from codex's model-visible prompt: $(oneline "$out")"
  fi
}

# --- install-copilot
deep_copilot() {
  local harness=install-copilot
  if ! command -v copilot >/dev/null 2>&1; then
    skip "$harness" "copilot not on PATH"
    return
  fi
  [ "$MARKET_REWRITE_OK" = 1 ] || { skip "$harness" "marketplace.json could not be rewritten for offline install (malformed descriptor)"; return; }
  local out
  out=$(cd "$WORK" && copilot plugin marketplace add "$WORK" >/dev/null 2>&1 &&
        copilot plugin install "${PLUGIN_NAME}@${MARKET}" >/dev/null 2>&1 &&
        copilot skill list 2>&1)
  if all_skills_present "$out"; then
    ok "$harness" "copilot skill list shows every skill under plugin skills"
  else
    not_ok "$harness" "copilot skill list did not show every skill: $(oneline "$out")"
  fi
}

# --- install-opencode: run from a NEUTRAL dir, NOT the plugin dir — opencode
# auto-discovers a ./skills tree in the cwd, which would pass even with the
# plugin uninstalled. The --pure control run (external plugins disabled) must
# NOT see the skills; without that control this check proves nothing.
deep_opencode() {
  local harness=install-opencode
  if ! command -v opencode >/dev/null 2>&1; then
    skip "$harness" "opencode not on PATH"
    return
  fi
  mkdir -p "$HOME/.config/opencode"
  printf '{"plugin":["%s"]}' "$WORK" > "$HOME/.config/opencode/opencode.json"
  local withp pure
  withp=$(cd "$NEUTRAL" && opencode debug skill 2>&1)
  pure=$(cd "$NEUTRAL" && opencode debug skill --pure 2>&1)
  if all_skills_present "$withp" && ! any_skill_present "$pure"; then
    ok "$harness" "opencode debug skill lists every skill via the plugin (and none with --pure)"
  elif all_skills_present "$withp"; then
    not_ok "$harness" "skills also appear with --pure; discovery is not coming from the plugin"
  else
    not_ok "$harness" "opencode debug skill did not list every skill: $(oneline "$withp")"
  fi
}

# --- install-grok: needs --trust for a local-path install. grok exposes no
# skill-name list, so `plugin details` reporting a populated skill-dir count is
# the deepest offline signal available.
deep_grok() {
  local harness=install-grok
  if ! command -v grok >/dev/null 2>&1; then
    skip "$harness" "grok not on PATH"
    return
  fi
  local out
  out=$(grok plugin install "$WORK" --trust >/dev/null 2>&1 &&
        grok plugin details "$PLUGIN_NAME" 2>&1)
  if grep -qE '[1-9][0-9]* skill dir' <<<"$out"; then
    ok "$harness" "grok plugin details reports a populated skill dir"
  else
    not_ok "$harness" "grok plugin details reported no skill dir: $(oneline "$out")"
  fi
}

# --- install-droid: registers the marketplace under the copy's DIRECTORY
# name, not the marketplace's declared name, so the install id is
# <name>@<copy-basename>. droid has no skill-list verb, so assert every skill's
# SKILL.md landed in its on-disk cache.
deep_droid() {
  local harness=install-droid
  if ! command -v droid >/dev/null 2>&1; then
    skip "$harness" "droid not on PATH"
    return
  fi
  local base out
  base=$(basename "$WORK")
  out=$(cd "$WORK" && droid plugin marketplace add "$WORK" >/dev/null 2>&1 &&
        droid plugin install "${PLUGIN_NAME}@${base}" >/dev/null 2>&1 &&
        droid plugin list 2>&1)
  if ! grep -qF -- "$PLUGIN_NAME" <<<"$out"; then
    not_ok "$harness" "droid plugin list did not show the plugin: $(oneline "$out")"
    return
  fi
  local name
  local missing=()
  for name in "${SKILL_NAMES[@]}"; do
    find "$HOME/.factory/plugins/cache" -path "*/$name/SKILL.md" 2>/dev/null | grep -q . ||
      missing+=("$name")
  done
  if [ "${#missing[@]}" -eq 0 ]; then
    ok "$harness" "plugin active and every skill's SKILL.md present in droid's cache"
  else
    not_ok "$harness" "plugin installed but skill(s) missing from droid's cache: ${missing[*]}"
  fi
}

# --- install-hermes: installs and enables from the emitted .hermes-plugin/,
# but `hermes skills list` covers only builtin/hub/local skills, never
# plugin-registered ones. So assert the install, then execute the emitted
# register() against a stub ctx to prove it registers each skill with a real
# SKILL.md path.
deep_hermes() {
  local harness=install-hermes
  if [ ! -f "$WORK/.hermes-plugin/__init__.py" ]; then
    skip "$harness" "plugin emits no .hermes-plugin/"
    return
  fi
  if ! command -v hermes >/dev/null 2>&1; then
    skip "$harness" "hermes not on PATH"
    return
  fi
  local inst
  inst=$(hermes plugins install "file://$WORK" --enable >/dev/null 2>&1
         hermes plugins list --plain --no-bundled 2>&1)
  if ! grep -qF -- "$PLUGIN_NAME" <<<"$inst"; then
    not_ok "$harness" "hermes plugins list did not show the plugin after install: $(oneline "$inst")"
    return
  fi
  local reg
  reg=$(python3 - "$HOME" "$WORK" <<'PY'
import glob, importlib.util, os, sys

home, work = sys.argv[1], sys.argv[2]
candidates = glob.glob(os.path.join(home, ".hermes/plugins/*/.hermes-plugin/__init__.py"))
candidates.append(os.path.join(work, ".hermes-plugin/__init__.py"))
candidates = [c for c in candidates if os.path.isfile(c)]
if not candidates:
    sys.exit("no installed .hermes-plugin/__init__.py found")

spec = importlib.util.spec_from_file_location("ehp", candidates[0])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StubCtx:
    def __init__(self):
        self.registered = []

    def register_skill(self, name, path):
        self.registered.append((name, bool(path.exists())))

    def register_hook(self, *args, **kwargs):
        pass


ctx = StubCtx()
module.register(ctx)
for name, exists in ctx.registered:
    if exists:
        print(name)
PY
)
  if all_skills_present "$reg"; then
    ok "$harness" "plugin enabled; register() registers every skill with a real SKILL.md (skills list cannot show plugin skills)"
  else
    not_ok "$harness" "register() did not register every skill with a real SKILL.md: $(oneline "$reg")"
  fi
}

# --- install-pi: pi's real runtime needs auth, so drive the emitted extension
# directly under bun — register its hooks against a stub, invoke the
# resources_discover hook, and assert the skills dir it returns contains every
# skill. This runs the generated TS, not a parse of it (check_pi above only
# imports it — both are kept).
deep_pi() {
  local harness=install-pi
  local ext="$WORK/.pi/extensions/${PLUGIN_NAME}.ts"
  if [ ! -f "$ext" ]; then
    skip "$harness" "plugin emits no .pi/ extension"
    return
  fi
  if ! command -v bun >/dev/null 2>&1; then
    skip "$harness" "bun not on PATH"
    return
  fi
  local probe out
  probe="$NEUTRAL/pi-probe.ts"
  cat > "$probe" <<TS
const handlers: Record<string, Function> = {}
const mod = await import("$ext")
mod.default({ on: (event: string, fn: Function) => { handlers[event] = fn } } as any)
const res = await handlers["resources_discover"]()
const { readdirSync, existsSync } = await import("node:fs")
for (const p of res.skillPaths) if (existsSync(p)) console.log(readdirSync(p).join("\n"))
TS
  out=$(bun run "$probe" 2>&1)
  if all_skills_present "$out"; then
    ok "$harness" "extension resources_discover returns a skills dir containing every skill"
  else
    not_ok "$harness" "pi extension did not surface every skill: $(oneline "$out")"
  fi
}

# Lists every executable regular file under the plugin's skills tree, one per
# line, as a path relative to the plugin root ($1). This IS the source-tree
# truth the exec-bit sweep is built on: a skill can ship a script, and if any
# install path drops its mode bit the skill dies with "Permission denied"
# while every other check stays green (issue #9). Empty output (no skills tree,
# or no executables) is normal — most plugins ship none.
discover_exec_skill_files() {
  local root="$1" skills_root="$1/skills" abs
  [ -d "$skills_root" ] || return 0
  find "$skills_root" -type f -perm -u+x 2>/dev/null | sort |
    while IFS= read -r abs; do
      printf '%s\n' "${abs#"$root"/}"
    done
}

# --- exec-bits: assert every executable skill file keeps its mode bit through
# staging and through each harness's real install. Reuses the installs the
# per-harness deep checks already performed this run, so deep_checks calls it
# AFTER them. Locates each installed copy by matching a known relative path
# (the first discovered executable), never a hardcoded version/hash-suffixed
# cache dir. opencode and pi are intentionally absent: opencode loads the
# plugin in place and pi runs the emitted TS directly, so neither produces an
# installed copy whose mode bits could differ from the staged baseline.
exec_bits_harness() {
  local harness="$1" cli="$2" root="$3" first_rel="$4"
  if ! command -v "$cli" >/dev/null 2>&1; then
    skip "exec-bits-$harness" "$cli not on PATH"
    return
  fi
  local hit inst_root
  hit=$(find "$root" -type f -path "*/$first_rel" 2>/dev/null | head -n1)
  if [ -z "$hit" ]; then
    skip "exec-bits-$harness" "no installed copy found under $root"
    return
  fi
  inst_root="${hit%/"$first_rel"}"
  local rel
  local lost=()
  for rel in "${EXEC_FILES[@]}"; do
    { [ -f "$inst_root/$rel" ] && [ -x "$inst_root/$rel" ]; } || lost+=("$rel")
  done
  if [ "${#lost[@]}" -eq 0 ]; then
    ok "exec-bits-$harness" "every executable skill file survived at $inst_root"
  else
    not_ok "exec-bits-$harness" "lost the executable bit: $(oneline "${lost[*]}")"
  fi
}

deep_exec_bits() {
  EXEC_FILES=()
  local rel
  while IFS= read -r rel; do
    [ -n "$rel" ] && EXEC_FILES+=("$rel")
  done < <(discover_exec_skill_files "$PLUGIN_ROOT")

  if [ "${#EXEC_FILES[@]}" -eq 0 ]; then
    skip exec-bits "plugin ships no executable skill files"
    return
  fi

  # Source baseline first: the staged copy $WORK is what every install actually
  # came from, so a bit lost there poisons the whole sweep — report it and stop
  # rather than running per-harness checks against a broken baseline.
  local lost=()
  for rel in "${EXEC_FILES[@]}"; do
    [ -x "$WORK/$rel" ] || lost+=("$rel")
  done
  if [ "${#lost[@]}" -gt 0 ]; then
    not_ok exec-bits-source "executable bit missing in the staged copy: $(oneline "${lost[*]}")"
    return
  fi
  ok exec-bits-source "every executable skill file is executable in the staged copy (${#EXEC_FILES[@]} file(s))"

  local first="${EXEC_FILES[0]}"
  exec_bits_harness claude-code claude "$HOME/.claude/plugins" "$first"
  exec_bits_harness gemini gemini "$HOME/.gemini/extensions" "$first"
  exec_bits_harness codex codex "$HOME/.codex/plugins" "$first"
  exec_bits_harness copilot copilot "$HOME/.copilot/installed-plugins" "$first"
  exec_bits_harness droid droid "$HOME/.factory/plugins" "$first"
  exec_bits_harness grok grok "$HOME/.grok/installed-plugins" "$first"
  exec_bits_harness hermes hermes "$HOME/.hermes/plugins" "$first"

  # kimi installs only through its TUI (see install-kimi note above), so no
  # on-disk copy is produced by this offline run.
  skip exec-bits-kimi "install is TUI-only"
}

# Drives the deep tier: resolve the plugin name and skill set, stage a
# writable git-repo copy, and run each harness check. Called after the shallow
# checks so both share the FAILED/exit-3 accounting.
deep_checks() {
  PLUGIN_NAME=$(jq -r '.name // empty' "$PLUGIN_ROOT/.claude-plugin/plugin.json" 2>/dev/null)
  [ -n "$PLUGIN_NAME" ] || PLUGIN_NAME="$EH_PLUGIN_NAME"

  # Install ids are `<plugin>@<marketplace-name>`, and the marketplace name is
  # the descriptor's own declared `.name`, now configurable (marketplace.name)
  # rather than always `<plugin>-dev`. claude-code and copilot install through
  # Claude Code's `.claude-plugin/marketplace.json`; codex installs through the
  # Agent Plugins spec descriptor `.agents/plugins/marketplace.json` (verified
  # against the container's codex 0.146.0), whose name the marketplace.* config
  # deliberately does NOT touch — so codex needs its own derivation from that
  # file, not MARKET. Both fall back to `<plugin>-dev` when their descriptor is
  # absent/unparseable.
  MARKET=$(market_name "$PLUGIN_ROOT/.claude-plugin/marketplace.json" "${PLUGIN_NAME}-dev")
  CODEX_MARKET=$(market_name "$PLUGIN_ROOT/.agents/plugins/marketplace.json" "${PLUGIN_NAME}-dev")

  # Skill names: every directory under the plugin's skills root that holds a
  # SKILL.md — the same skills/ tree every adapter emits its skills from.
  local skills_root="$PLUGIN_ROOT/skills" dir
  SKILL_NAMES=()
  if [ -d "$skills_root" ]; then
    for dir in "$skills_root"/*/; do
      [ -f "${dir}SKILL.md" ] && SKILL_NAMES+=("$(basename "$dir")")
    done
  fi

  # No skills -> the whole tier is a documented no-op.
  if [ "${#SKILL_NAMES[@]}" -eq 0 ]; then
    local h
    for h in claude-code gemini codex copilot opencode grok droid hermes pi kimi cursor devin; do
      skip "install-$h" "plugin has no skills to verify"
    done
    return
  fi

  # Writable copy the installers clone/copy out of, plus a neutral dir opencode
  # runs from. DEEP_TMP is global so the EXIT trap can still see it. The copy
  # is a git repo because codex/droid/hermes install by cloning; it is removed
  # on exit and never touches the mounted plugin dir.
  DEEP_TMP=$(mktemp -d)
  trap 'rm -rf "$DEEP_TMP"' EXIT
  WORK="$DEEP_TMP/plugin-copy"
  NEUTRAL="$DEEP_TMP/neutral"
  cp -r "$PLUGIN_ROOT" "$WORK"
  # See rewrite_market_source_local() above: makes the copy installable
  # offline regardless of the configured marketplace.source. Must run before
  # the git snapshot below — codex/droid/hermes install by cloning it.
  MARKET_REWRITE_OK=1
  rewrite_market_source_local
  mkdir -p "$NEUTRAL"
  git -C "$WORK" init -q
  git -C "$WORK" add -A >/dev/null 2>&1
  git -C "$WORK" -c user.email=deep-check@everyharness.local -c user.name=everyharness \
    commit -qm "everyharness deep-check snapshot" >/dev/null 2>&1 || true

  deep_claude_code
  deep_gemini
  deep_codex
  deep_copilot
  deep_opencode
  deep_grok
  deep_droid
  deep_hermes
  deep_pi

  # --- harnesses with no offline path to skill enumeration.
  # kimi IS verifiable, but only by driving its TUI, which this script does not
  # automate. Verified by hand (2026-08-11) and reproducible as follows:
  #   printf 'set -g extended-keys on\n' > ~/.tmux.conf   # else Enter never submits
  #   tmux new-session -d -s kimi -c "$WORK" -x 200 -y 50 kimi
  #   # /plugins -> Tab to "Custom" -> type the copy path -> Enter -> Down ->
  #   # Enter (trust); then /plugins -> Enter for details. It reports the
  #   # manifest, Skills (N), and state ok.
  skip install-kimi "install is TUI-only; verified by hand via tmux (see comment above)"
  skip install-cursor "cursor-agent requires login before it will load a plugin"
  skip install-devin "no devin CLI exists in the image"

  # Runs last: reuses the installs the per-harness deep checks above performed
  # to assert executable skill scripts kept their mode bit end to end (#9).
  deep_exec_bits
}

check_claude_code
check_opencode
check_pi
check_hermes
check_gemini
check_manifest_harness codex .codex-plugin/plugin.json
check_manifest_harness cursor .cursor-plugin/plugin.json
check_manifest_harness devin .devin-plugin/plugin.json
check_manifest_harness kimi .kimi-plugin/plugin.json
check_manifest_harness agent-plugins-1.0 plugin.json
check_manifest_harness agent-plugins-1.0 mcp.json
check_manifest_harness agents-marketplace .agents/plugins/marketplace.json

deep_checks

if [ "$FAILED" -eq 1 ]; then
  exit 3
fi
exit 0
