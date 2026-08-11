# everyharness-container + `everyharness test` Implementation Plan (Plan 5 of series)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the shared multi-harness container as its own public repo (`prime-radiant-inc/everyharness-container`, MIT) with a GHCR publish workflow, and land `everyharness test` v1 — container-backed install checks for a generated plugin.

**Architecture:** The container repo extracts the REUSABLE layer of superpowers-evals' proven Dockerfile — base tooling + every harness CLI install — and drops the evals-specific pieces (serf, gauntlet, quorum, evals workdir). Two consumers: `everyharness test` (now) and superpowers-evals (later migration, that repo's own task). `everyharness test` mounts a generated plugin into the image and runs a check script (shipped in the everyharness repo, mounted in) that exercises each harness's cheapest offline verification.

**Ground truth:** superpowers-evals `container/` fetched 2026-08-11 into the session scratchpad (`evals-container/`): Dockerfile (193 lines), Dockerfile.claude-slim, bin/evals-tool-versions, bin/quorum. The gauntlet stage in the evals Dockerfile is an external build context — NOT part of what we extract. Local docker 29.7.1, 292G free.

## Global Constraints

- Container repo: zero secrets baked in; all harness CLIs pinned to the same versions the evals Dockerfile pins today (npm block verbatim; GOOSE_VERSION/HERMES_COMMIT args kept); `linux/amd64` only in CI (TARGETARCH plumbing retained for future arm64).
- GHCR image: `ghcr.io/prime-radiant-inc/everyharness-container` tagged `latest` + git sha on main pushes; PRs build without pushing. Workflow uses buildx with GHA cache.
- everyharness stays runtime-dep-frozen (docker invoked via child_process; no docker SDK).
- `everyharness test` NEVER invokes an LLM and needs no API keys — offline checks only. Exit codes: 0 all checks pass, 2 check failures, 1 config/environment errors (docker missing → actionable message).
- TDD where testable without the image; the image-dependent path is verified live once the image exists (documented in the task).

## Design decisions

1. **Extraction cutlist.** KEEP: base apt block, node 22 + npm CLI block (all pinned versions verbatim), bun, uv, rust, mise, cursor-agent, mini-swe-agent/trae-agent uv tools, goose, hermes installer (HERMES_COMMIT arg), mimo, agy, the auth-home env vars, `bin/harness-versions` (adapted from evals-tool-versions: same version-printing behavior, renamed, evals-specific rows dropped). DROP: serf, gauntlet stage + wrapper, quorum, `WORKDIR /workspace/evals` (becomes `/workspace`). Keep `CMD ["sleep","infinity"]`.
2. **Checks live in everyharness**, not the image: `checks/run-checks.sh` (bash, mounted at /checks) executes per-harness check functions against the mounted plugin at /plugin and prints TAP-ish `ok <harness>: <what>` / `not ok ...` lines; the CLI parses the exit code + passes through output. V1 checks: claude-code → `claude plugin validate --strict /plugin`; opencode → `node --input-type=module -e "import('/plugin/.opencode/plugins/<name>.js')"` structural load (name derived by the CLI and passed as env); pi → `bun x tsc? NO — structural: bun build --no-bundle? keep simple: node --experimental-strip-types syntax load if available, else file-presence`; USE: pi → `bun -e "await import('/plugin/.pi/extensions/<name>.ts')"` (bun executes TS natively; import succeeds without pi API? the module imports a type only from the pi package — type-only import vanishes at runtime for bun? bun strips types; `import type` is erased, so the import works) — if that proves flaky in live verification, downgrade to file presence + note; hermes → `python3 -c "import ast,sys; ast.parse(open('/plugin/.hermes-plugin/__init__.py').read())"`; gemini → `gemini extensions validate?` — probe `gemini extensions --help` live in-container during Task 4's verification; if no offline validator exists, jq-parse gemini-extension.json + file presence; manifest-only harnesses (codex/cursor/devin/kimi/agent-plugins/agents-marketplace) → jq parse of each manifest + referenced-paths existence.
3. **`everyharness test [--dir] [--image <ref>] [--keep]`**: requires a generated plugin (manifest present, else ConfigError telling the user to generate). Runs `docker run --rm -v <plugin>:/plugin:ro -v <checksdir>:/checks:ro <image> bash /checks/run-checks.sh`, streaming output. `--image` defaults to `ghcr.io/prime-radiant-inc/everyharness-container:latest`. Docker absent → exit 1 with `docker is required for everyharness test; install docker or run the checks manually (see docs/install/*)`. Check script failures → exit 2 listing failing lines.
4. **Container repo layout:** `Dockerfile`, `bin/harness-versions`, `.github/workflows/build.yml`, `README.md` (what it is, consumers, pull command, version pins policy, how to bump a CLI), `LICENSE` (MIT, Prime Radiant, Inc.). No plan/spec docs of its own beyond the README — this plan is its provenance.

## Tasks

### Task 1: Container repo content (local)
Create `/home/jesse/git/everyharness-container` (git init -b main): all files per decision 4, Dockerfile per decision 1 cutlist (adapt from the fetched ground truth verbatim where kept), workflow (buildx, GHA cache, push-to-GHCR gated on push-to-main, permissions packages:write), README with the pull command and a "consumers" section naming everyharness test + superpowers-evals (future). `bin/harness-versions` executable. hadolint if available (else skip, note). Commit.

### Task 2: Local image build validation
`docker build` the image locally (background, expect 20-60 min). On success: `docker run --rm <img> harness-versions` prints the versions table; capture output. On failure: fix the Dockerfile (the cutlist may have left a dangling reference), rebuild. Commit fixes.

### Task 3: Publish repo + CI
`gh repo create prime-radiant-inc/everyharness-container --public --source . --push` + watch the CI build (long; use background + gh run watch). On CI green, confirm `ghcr.io/prime-radiant-inc/everyharness-container:latest` is pullable (packages default private → may need `gh api` to set package visibility public; do it and verify anonymous pull... verify at least authenticated pull). Record image digest in the README (or badge).

### Task 4: `everyharness test` v1 + checks script (everyharness repo, new worktree `container-test`)
Per decisions 2-3. TDD for the CLI plumbing (docker-absent path via PATH manipulation; arg validation; exit-code mapping with a fake docker shim script on PATH that replays canned output). The checks script itself is verified LIVE against the locally built image with the kitchen-sink plugin (generate → test) — capture full output in the report; probe gemini's offline validator during this step and finalize the gemini check accordingly. Also: docs/install note in README (Usage gains `npx everyharness test`), support-matrix doc unchanged. Commit(s).

### Task 5: Wrap
everyharness v0.5.0 (version-sync test updates automatically), README status line: container testing shipped (v1 offline checks; LLM-level acceptance testing remains future work with superpowers-evals). Whole-branch review (both repos' diffs), merge, push, CI, image reference sanity.

## Self-Review Notes
- Decision 2's pi check has an explicit fallback path (file presence) if the bun import proves flaky live — the task text authorizes the downgrade with a note, no re-planning needed.
- The evals Dockerfile's npm pins predate today; pinning verbatim is deliberate (proven-working set); bumping is the container repo's own future concern (README documents the policy).
- superpowers-evals migration is explicitly out of scope (recorded in the spec since Plan 1).
