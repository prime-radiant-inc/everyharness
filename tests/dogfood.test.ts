import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { generate } from '../src/generate.js'

// Design decision 7 / spec decision 7's north-star acceptance test: prove
// everyharness's config + overrides are expressive enough to regenerate
// superpowers' own hand-maintained per-harness manifests semantically
// (modulo documented, by-design differences). Comparison is parsed-JSON
// deep equality (`toEqual`), not raw bytes: JSON key order and formatting
// are explicitly not a goal (Jesse's ruling, 2026-08-12 -- see Finding 3's
// Resolution in docs/superpowers/plans/2026-08-11-dogfood-findings.md) and
// are never asserted here. Reads the LOCAL checkout via `git archive dev`
// (never touches the checkout's working tree or index -- archive reads
// straight from the object database regardless of what's currently checked
// out); skips gracefully when the checkout isn't present (CI on GitHub
// won't have it). Overridable via EH_SUPERPOWERS_REPO for machines where
// the checkout lives somewhere else.
//
// That `git archive dev` reads the *live* branch tip, not a pinned SHA, is
// deliberate: this test is a tripwire against superpowers and everyharness
// drifting apart, not a snapshot regression test. A hand-edit to
// superpowers' real manifests (or an everyharness change that stops
// reproducing them) should fail this test the next time it runs, which a
// pinned SHA would silently defeat.
const SUPERPOWERS_REPO = process.env.EH_SUPERPOWERS_REPO ?? '/home/jesse/git/superpowers/superpowers'
const SUPERPOWERS_AVAILABLE = existsSync(join(SUPERPOWERS_REPO, '.git'))

// The hand-maintained manifests this test regenerates and compares. Also
// read into `originals` (below) before the corresponding paths are deleted
// from the working copy, since generate() would otherwise refuse to
// overwrite them (they aren't tracked in a prior everyharness manifest, so
// they look like unrelated pre-existing files).
const COMPARED_FILES = [
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  '.codex-plugin/plugin.json',
  '.devin-plugin/plugin.json',
  '.kimi-plugin/plugin.json',
  '.cursor-plugin/plugin.json',
  'gemini-extension.json',
  '.agents/plugins/marketplace.json',
] as const
type ComparedFile = (typeof COMPARED_FILES)[number]

// Hand-maintained paths removed from the extracted working copy before
// generate() runs. Each one is either a manifest generate() is about to
// rewrite (and would otherwise refuse to clobber) or a hand-authored
// equivalent of a file everyharness emits itself under a different name/path
// (package.json, .opencode/, .pi/, GEMINI.md). Everything else in the real
// tree (skills/, hooks/hooks.json, docs/, tests/, README.md, ...) is left in
// place: skills/ and hooks/hooks.json are component sources everyharness
// reads, and the rest doesn't collide with anything generate() writes.
const HAND_MAINTAINED_PATHS = [
  '.claude-plugin',
  '.codex-plugin',
  '.cursor-plugin',
  '.devin-plugin',
  '.kimi-plugin',
  '.hermes-plugin',
  '.agents',
  'gemini-extension.json',
  'GEMINI.md',
  'package.json',
  '.opencode',
  '.pi',
]

interface ExpectedDifference {
  file: ComparedFile
  path: string
  reason: string
}

// Documented, by-design (or documented-gap) differences between generated
// and real output. Every entry is a top-level manifest key; the comparison
// below deletes that key from BOTH the generated and original objects
// before asserting deep equality, so an entry only masks the exact
// difference it names -- anything else still fails the test. This list is
// the acceptance criterion: an undocumented difference fails.
//
// Empty as of this branch. All three differences ever tolerated here --
// claude-code's and cursor's forced hooks pointer, and marketplace.json's
// hardcoded description -- are now closed: `bootstrap.emitHooks: false`
// (see src/adapters/shared.ts's bootstrapEmitsHooks) lets superpowers keep
// its own hand-wired hooks instead of the generated pointer, and
// `marketplace.description` (issue #7) gives marketplaceManifest() an
// override hook. See docs/superpowers/plans/2026-08-11-dogfood-findings.md
// for the Resolution section recording how each one closed.
const EXPECTED_DIFFERENCES: ExpectedDifference[] = []

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8'))
}

// Deletes every EXPECTED_DIFFERENCES key registered for `file` from clones
// of both sides before comparison, so the deep-equal assertion below only
// ever ignores exactly the documented differences.
function withExpectedDifferencesRemoved(
  file: ComparedFile,
  generated: Record<string, unknown>,
  original: Record<string, unknown>,
): { generated: Record<string, unknown>; original: Record<string, unknown> } {
  const g = structuredClone(generated)
  const o = structuredClone(original)
  for (const diff of EXPECTED_DIFFERENCES) {
    if (diff.file !== file) continue
    delete g[diff.path]
    delete o[diff.path]
  }
  return { generated: g, original: o }
}

// Builds the everyharness.yaml config that should regenerate superpowers'
// real manifests. Per-harness override VALUES are read directly off the
// real originals (rather than hand-transcribed) so a copy/paste slip in a
// long field -- kimi's multi-paragraph skillInstructions, codex's 14-key
// interface block -- can't silently pass or fail the test for the wrong
// reason. What's under test is the STRUCTURAL claim (design decision 7):
// given the right override values, does deepMerge + each adapter's emit()
// reproduce the exact real manifest shape? That's independent of where the
// override strings themselves came from.
function buildConfig(originals: Record<ComparedFile, Record<string, unknown>>): Record<string, unknown> {
  const claude = originals['.claude-plugin/plugin.json']
  const marketplace = originals['.claude-plugin/marketplace.json']
  const codex = originals['.codex-plugin/plugin.json']
  const devin = originals['.devin-plugin/plugin.json']
  const kimi = originals['.kimi-plugin/plugin.json']
  const cursor = originals['.cursor-plugin/plugin.json']
  const gemini = originals['gemini-extension.json']
  const agentsMarketplace = originals['.agents/plugins/marketplace.json'] as {
    interface: { displayName: string }
    plugins: unknown[]
  }
  const codexAuthor = codex.author as { url: string }

  return {
    name: claude.name,
    version: claude.version,
    description: claude.description,
    author: claude.author,
    homepage: claude.homepage,
    repository: claude.repository,
    license: claude.license,
    keywords: claude.keywords,
    bootstrap: { skill: 'using-superpowers' },
    // Closes Finding 1: marketplaceManifest() (src/adapters/claude-code.ts)
    // deep-merges this onto its hardcoded `Development marketplace for
    // ${config.name}` default, reproducing superpowers' hand-written copy.
    marketplace: { description: marketplace.description },
    harnesses: {
      // hooks: own -- superpowers hand-wires its own bootstrap hooks
      // (hooks/run-hook.cmd, hooks/session-start) directly under hooks/ rather
      // than the adapters' generated hooks/everyharness/*.json, so neither
      // claude-code nor cursor should force their own hooks pointer into the
      // manifest. See src/adapters/shared.ts's bootstrapEmitsHooks.
      'claude-code': { hooks: 'own' },
      // cursor: hooks own (same reason as claude-code) plus a manifest patch.
      // display name and description are cursor-specific copy; hooks points at
      // superpowers' own hand-wired hooks-cursor.json -- with hooks: own,
      // pluginManifest() no longer supplies its own hooks pointer, so the
      // manifest patch carries the real value instead. Everything else
      // (author, homepage, repository, license, keywords) matches the shared
      // base fields above with no patch.
      cursor: {
        hooks: 'own',
        manifest: {
          displayName: cursor.displayName,
          description: cursor.description,
          hooks: cursor.hooks,
        },
      },
      // gemini: only description differs from the shared base (gemini's
      // extensionManifest doesn't include author/homepage/repository/
      // license/keywords at all).
      gemini: {
        manifest: {
          description: gemini.description,
        },
      },
      // codex: its own description + keyword set, an extra author.url
      // (deep-merged onto the shared {name,email}), and the full portal
      // `interface` block, which has no base-field equivalent.
      codex: {
        manifest: {
          description: codex.description,
          keywords: codex.keywords,
          author: { url: codexAuthor.url },
          interface: codex.interface,
        },
      },
      // devin: shares codex's description and keyword set but keeps the
      // shared plain {name,email} author (no url).
      devin: {
        manifest: {
          description: devin.description,
          keywords: devin.keywords,
        },
      },
      // kimi: its own (shorter) description, codex's keyword set, its
      // tool-mapping skillInstructions, and its own (smaller) interface
      // block. Uses repository: null to delete the inherited field.
      kimi: {
        manifest: {
          description: kimi.description,
          keywords: kimi.keywords,
          skillInstructions: kimi.skillInstructions,
          interface: kimi.interface,
          repository: null,
        },
      },
      // agents-marketplace: displayName patch plus a full replacement of the
      // plugins array (deepMerge replaces arrays wholesale) to add the
      // category field the default descriptor never sets.
      'agents-marketplace': {
        manifest: {
          interface: { displayName: agentsMarketplace.interface.displayName },
          plugins: agentsMarketplace.plugins,
        },
      },
    },
  }
}

if (!SUPERPOWERS_AVAILABLE) {
  console.log(
    `[dogfood] superpowers checkout not found at ${SUPERPOWERS_REPO} (or has no .git) -- skipping the dogfood test. Clone https://github.com/obra/superpowers there, or set EH_SUPERPOWERS_REPO to point at an existing checkout, to run it locally.`,
  )
}

describe.skipIf(!SUPERPOWERS_AVAILABLE)('dogfood: regenerate superpowers hand-maintained manifests', () => {
  const originals: Record<ComparedFile, Record<string, unknown>> = {} as Record<ComparedFile, Record<string, unknown>>
  const generated: Record<ComparedFile, Record<string, unknown>> = {} as Record<ComparedFile, Record<string, unknown>>
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'eh-dogfood-'))

    // Read-only on the source repo: `git archive` reads straight from the
    // object database at the `dev` ref, regardless of the checkout's
    // current branch or working-tree state, and never touches either.
    execSync(`git -C "${SUPERPOWERS_REPO}" archive dev | tar -x -C "${dir}"`)

    for (const file of COMPARED_FILES) {
      originals[file] = readJson(join(dir, file))
    }

    for (const path of HAND_MAINTAINED_PATHS) {
      rmSync(join(dir, path), { recursive: true, force: true })
    }

    writeFileSync(join(dir, 'everyharness.yaml'), stringify(buildConfig(originals)))

    generate(dir)

    for (const file of COMPARED_FILES) {
      generated[file] = readJson(join(dir, file))
    }
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  for (const file of COMPARED_FILES) {
    it(`regenerates ${file} to match the real manifest, modulo documented differences`, () => {
      const { generated: g, original: o } = withExpectedDifferencesRemoved(file, generated[file], originals[file])
      expect(g).toEqual(o)
    })
  }
})
