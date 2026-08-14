# Documentation Index

One row per doc. `Reader` is the addressed reader (`user`, `operator`,
`contributor`, `adopter`, `+`-joined for genuinely sectioned docs, `—` for
point-in-time rows). `Class` is the confirmed evergreen/point-in-time
classification of record. `Owns` is machine-readable: the path globs whose
facts this doc owns; `—` for point-in-time docs. The fenced table is
machine-maintained; edit rows, never the sentinels.

<!-- doc-index:begin -->
| Doc | What | Reader | Class | Owns |
| --- | --- | --- | --- | --- |
| `README.md` | usage, config reference (`everyharness.yaml`), CLI commands | user+adopter | evergreen | src/cli.ts, src/config.ts, src/bump.ts, src/validate.ts, src/test-command.ts, checks/run-checks.sh, schemas/** |
| `docs/BROCHURE.md` | what everyharness is and who it's for | adopter | evergreen | src/adapters/**, src/cli.ts, src/generate.ts, src/manifest.ts, src/validate.ts, src/init.ts, src/import.ts, src/bump.ts, src/docs-emit.ts, src/bootstrap/generated.ts, checks/run-checks.sh, tests/dogfood.test.ts |
| `docs/superpowers/specs/2026-08-10-everyharness-design.md` | design spec | — | point-in-time | — |
| `docs/superpowers/plans/2026-08-10-everyharness-core.md` | plan | — | point-in-time | — |
| `docs/superpowers/plans/2026-08-11-dogfood-findings.md` | findings | — | point-in-time | — |
| `docs/superpowers/plans/2026-08-11-eval-feedback-fixes.md` | plan | — | point-in-time | — |
| `docs/superpowers/plans/2026-08-11-everyharness-container.md` | plan | — | point-in-time | — |
| `docs/superpowers/plans/2026-08-11-everyharness-init-import-docs.md` | plan | — | point-in-time | — |
| `docs/superpowers/plans/2026-08-11-everyharness-inprocess-adapters.md` | plan | — | point-in-time | — |
| `docs/superpowers/plans/2026-08-11-everyharness-manifest-adapters.md` | plan | — | point-in-time | — |
| `docs/superpowers/plans/2026-08-11-hook-double-fire-findings.md` | findings | — | point-in-time | — |
| `docs/superpowers/plans/2026-08-12-bump-command.md` | plan | — | point-in-time | — |
| `docs/superpowers/plans/2026-08-12-config-v2.md` | plan | — | point-in-time | — |
| `docs/superpowers/plans/2026-08-12-exec-bits-and-unskip.md` | plan | — | point-in-time | — |
| `docs/superpowers/plans/2026-08-12-per-harness-emithooks.md` | plan | — | point-in-time | — |
| `docs/superpowers/plans/2026-08-12-publishable-marketplace.md` | plan | — | point-in-time | — |
| `docs/superpowers/plans/2026-08-12-respect-user-hooks.md` | plan | — | point-in-time | — |
| `docs/superpowers/plans/2026-08-12-validate-loads-config.md` | plan | — | point-in-time | — |
<!-- doc-index:end -->

<!-- Decided gaps: no DICTIONARY.md yet (voice comes from the publication-writer
preset; revisit when project terminology needs a record, 2026-08-13); no user
tutorial beyond README usage (project is pre-alpha and README's usage block
covers first success, 2026-08-13). -->
