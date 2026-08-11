#!/usr/bin/env bash
# checks/run-checks.sh — container-backed offline install checks for a
# generated everyharness plugin.
#
# Ships with the everyharness npm package (see package.json "files") and is
# bind-mounted read-only at /checks by `everyharness test`
# (src/test-command.ts), which also mounts the generated plugin read-only at
# /plugin and sets EH_PLUGIN_NAME to the plugin's name from
# everyharness.yaml. Runs each harness's cheapest offline "does this
# actually load/parse" check against the mounted plugin — never invokes an
# LLM, needs no API keys or network access.
#
# Set EH_PLUGIN_ROOT to point at a different plugin root (default: /plugin).
# This is only for local development — it lets this script be unit-tested
# directly against a generated fixture without a container; the real
# `everyharness test` invocation always mounts at /plugin and relies on the
# default.
#
# Output is TAP-ish: one line per harness check —
#   ok <harness>: <what passed>
#   not ok <harness>: <what failed>
#   skip <harness>: <why it was skipped (not generated, tool unavailable)>
# Exit status: 0 if no "not ok" line was printed, else 1.
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

# Collapses a (possibly multi-line) command-error blob into one line so a
# single `not ok` line stays grep-able.
oneline() {
  printf '%s' "$1" | tr '\n' ' '
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
# imports cleanly without the (uninstalled) pi package present. If that
# proves flaky in practice, bun's absence or failure downgrades to
# confirming the file is on disk rather than failing the check outright.
check_pi() {
  local harness=pi
  local file="$PLUGIN_ROOT/.pi/extensions/${EH_PLUGIN_NAME}.ts"
  if [ ! -f "$file" ]; then
    skip "$harness" "not generated"
    return
  fi
  if ! command -v bun >/dev/null 2>&1; then
    # Fallback covers ONLY bun's absence; a present-but-failing import is a real failure.
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

exit "$FAILED"
