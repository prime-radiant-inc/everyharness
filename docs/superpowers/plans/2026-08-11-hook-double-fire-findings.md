# Hook double-fire investigation — findings (2026-08-11)

Plan 4 Task 7 (decision 8). Open question since Plan 2/3: when the claude-code
adapter points `.claude-plugin/plugin.json`'s `hooks` key at the merged file
`hooks/everyharness/hooks.json` (user hooks + bootstrap SessionStart entry),
while the user's own `hooks/hooks.json` stays at Claude Code's auto-discovery
default path — does every user hook fire twice?

**Finding: CONFIRMED SUPPLEMENT, with execution-time dedup of exact-duplicate
hook entries.** Claude Code loads *both* `hooks/hooks.json` (auto-discovery)
and the file named by the manifest `hooks` key, and registers hooks from
both. But when the same `{matcher, command}` pair appears in more than one
loaded source, Claude Code executes it only once per session, not once per
source. Net effect for everyharness's merged-hooks design: **user hooks do
not double-fire**, because `mergedClaudeHooks()` always clones the user's
hooks byte-for-byte into the merged file, so every user hook that exists in
`hooks/hooks.json` has an exact duplicate in `hooks/everyharness/hooks.json`
and collapses to one execution. The bootstrap SessionStart entry (present
only in the merged file) fires exactly once, as expected.

Caveat: this dedup is content-based (same matcher + same command string), not
based on the two files being "the same conceptual hook." If a user hand-edits
`hooks/hooks.json` and does **not** re-run `everyharness generate`, the stale
merged file's copy of the old hook and the live source file's copy of the
edited hook would differ and would *not* dedupe — both would fire. This is a
narrow drift window, not a general double-fire bug; it resolves itself the
moment `generate` is re-run.

## Method

Claude Code 2.1.217 supports `--plugin-dir <path>` to load a plugin from a
local directory for a single session — this made a scripted, headless probe
possible, so the investigation did not have to fall back to a manual-only
procedure.

1. Built the everyharness CLI from this worktree (`npm run build`).
2. Scaffolded a throwaway test plugin with `dist/cli.js init` in a scratch
   dir (default config: `bootstrap.generate: true`, which exercises the same
   merged-hooks code path as `bootstrap.skill`).
3. Added a hand-written `hooks/hooks.json` (the source file, at Claude Code's
   auto-discovery default path) containing one `SessionStart` hook whose
   command appends a marker line to a log file outside the plugin dir:
   ```json
   {
     "hooks": {
       "SessionStart": [
         { "matcher": "startup", "hooks": [
           { "type": "command", "command": "echo MARKER_USER_HOOK_FIRED >> <scratch>/hookfire.log" }
         ]}
       ]
     }
   }
   ```
4. Ran `dist/cli.js generate`, which produced the merged
   `hooks/everyharness/hooks.json` (user hook clone + the bootstrap
   `startup|clear|compact` entry) and left `plugin.json`'s `hooks` key
   pointing at it, while `hooks/hooks.json` (the source) was untouched —
   reproducing exactly the scenario in question.
5. To distinguish "manifest replaces auto-discovery" from "both load, exact
   duplicates dedupe," hand-edited each file to add one *unique* marker hook
   found only in that file (`MARKER_MANIFEST_ONLY_HOOK_FIRED` added only to
   the merged file; `MARKER_SOURCE_ONLY_HOOK_FIRED` added only to the source
   file). If auto-discovery were skipped entirely once a manifest `hooks` key
   is present, `MARKER_SOURCE_ONLY_HOOK_FIRED` would never fire.
6. Ran the session headless and counted marker lines:
   ```
   CLAUDE_CONFIG_DIR=<scratch>/config \
     claude -p 'say ok' --plugin-dir <scratch>/plugin \
     --output-format json --permission-mode bypassPermissions \
     [--debug-file <scratch>/debugN.log -d hooks]
   ```
   `CLAUDE_CONFIG_DIR` pointed at a throwaway directory created for this test
   only; `~/.claude` and all real user/global config were never touched.

Auth was not configured for the throwaway config dir (no API key was
available or fabricated for this test — see Result note below), so every run
ended in `"Not logged in · Please run /login"` after ~45ms. This turned out
not to matter: SessionStart hooks run during session initialization, before
the API/auth check, so hook firing counts are unaffected by the auth
failure. All runs completed and exited on their own (exit code 1, ~1s each);
none hung, none were backgrounded, nothing needed to be killed.

## Result

Four scripted runs, each appending to the same `hookfire.log`:

| Run | Files' unique markers present | New log lines this run |
|---|---|---|
| 1 | source: `USER` only | `USER` ×1 |
| 2 | source: `USER`; merged: `USER` clone, bootstrap, `MANIFEST_ONLY` | `USER` ×1, `MANIFEST_ONLY` ×1 |
| 3 | source: `USER`, `SOURCE_ONLY`; merged: `USER` clone, bootstrap, `MANIFEST_ONLY` | `USER` ×1, `MANIFEST_ONLY` ×1, `SOURCE_ONLY` ×1 |
| 4 (replication of 3) | same as run 3 | `USER` ×1, `SOURCE_ONLY` ×1, `MANIFEST_ONLY` ×1 |

`MARKER_SOURCE_ONLY_HOOK_FIRED` (exists only in the auto-discovered
`hooks/hooks.json`) fired every run once added — proving Claude Code does
not stop reading the auto-discovery path just because the manifest declares
a `hooks` key. `MARKER_USER_HOOK_FIRED` (byte-identical entry present in
*both* files) fired exactly once per run, never twice.

`--debug hooks` output (run 5, final file state — source has 2 hook entries,
merged has 3) made the mechanism explicit:

```
Read hooks.json for plugin plugin (enabled=true): <scratch>/plugin/hooks/hooks.json
Read manifest hooks for plugin plugin (enabled=true): ./hooks/everyharness/hooks.json
Registered 5 hooks from 1 plugins
Hook output does not start with {, treating as plain text   (×3)
"Hook SessionStart:startup (SessionStart) success: ..."     (×1, the bootstrap entry's JSON output)
```

Both files are read and contribute to the "Registered 5 hooks" count (2 from
source + 3 from merged = 5, exactly the raw union). But only 4 hooks
actually *executed* that session (3 plain-text command outputs + 1 JSON
bootstrap output) — one of the two byte-identical `USER` entries was
registered but not separately executed. This is the same pattern in run 2
(source 1 + merged 3 = 4 registered, 3 executed) and matches the marker-file
counts exactly. Registration is a straight union (supplement); execution
dedupes exact-duplicate `{matcher, command}` pairs.

## Practical implication for everyharness

No code change needed. The current merged-hooks design (decision 8's
"failure mode — double-fire — beats losing user hooks" reasoning) turns out
not to have a double-fire failure mode at all, as long as the merged file is
kept in sync with the source (which `generate()` guarantees on every run).
The adapter comment in `src/adapters/claude-code.ts` has been updated to
record this finding instead of leaving it as an open question.
