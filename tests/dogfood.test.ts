import { describe, it, expect, beforeAll } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { generate } from '../src/generate.js'

// Design decision 7 / spec decision 7's north-star acceptance test: prove
// everyharness's config + overrides are expressive enough to regenerate
// superpowers' own hand-maintained per-harness manifests byte-for-byte
// (modulo documented, by-design differences). Reads the LOCAL checkout via
// `git archive dev` (never touches the checkout's working tree or index --
// archive reads straight from the object database regardless of what's
// currently checked out); skips gracefully when the checkout isn't present
// (CI on GitHub won't have it).
const SUPERPOWERS_REPO = '/home/jesse/git/superpowers/superpowers'
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
// the acceptance criterion: an undocumented difference fails; see the task
// report for the two entries that are genuine everyharness expressiveness
// gaps (marked FINDING) versus the two that are intentional design.
const EXPECTED_DIFFERENCES: ExpectedDifference[] = [
  {
    file: '.claude-plugin/plugin.json',
    path: 'hooks',
    reason:
      "DESIGNED: everyharness's claude-code adapter always points the manifest's `hooks` key at its own generated hooks/everyharness/hooks.json when bootstrap.skill is set. superpowers hand-wires its bootstrap hook directly under hooks/ (hooks/run-hook.cmd, hooks/session-start) and relies on Claude Code's default hooks/hooks.json auto-discovery, so its plugin.json carries no `hooks` key at all. This is Plan 3's documented hooks-pointer difference, not a bug.",
  },
  {
    file: '.cursor-plugin/plugin.json',
    path: 'hooks',
    reason:
      'DESIGNED: same bootstrap-hook-path difference as claude-code above -- everyharness points at ./hooks/everyharness/hooks-cursor.json, superpowers points at ./hooks/hooks-cursor.json.',
  },
  {
    file: '.claude-plugin/marketplace.json',
    path: 'description',
    reason:
      "FINDING (expressiveness gap): claude-code's marketplaceManifest() (src/adapters/claude-code.ts) hardcodes the marketplace description as `Development marketplace for ${config.name}` and never deep-merges harnesses.overrides['claude-code'] the way pluginManifest() does -- there is no override hook for marketplace.json at all. superpowers' hand-written marketplace description ('Development marketplace for Superpowers core skills library') can't be reproduced through config as a result. Reported, not fixed here per Task 6's process rule.",
  },
  {
    file: '.kimi-plugin/plugin.json',
    path: 'repository',
    reason:
      "FINDING (expressiveness gap): superpowers' real .kimi-plugin/plugin.json omits `repository` entirely, but everyharness has no way to remove a field inherited from the top-level config for one adapter only -- harnesses.overrides is deep-merged (fileset.ts deepMerge), which can add or replace keys but never delete one. Top-level `repository` is required (present, matching) on claude-code/codex/devin/cursor, so kimi inherits it too, with no override able to unset it. Reported, not fixed here per Task 6's process rule.",
  },
]

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
    harnesses: {
      overrides: {
        // cursor: display name and description are cursor-specific copy;
        // everything else (author, homepage, repository, license,
        // keywords) matches the shared base fields above with no override.
        cursor: {
          displayName: cursor.displayName,
          description: cursor.description,
        },
        // gemini: only description differs from the shared base (gemini's
        // extensionManifest doesn't include author/homepage/repository/
        // license/keywords at all).
        gemini: {
          description: gemini.description,
        },
        // codex: its own description + keyword set, an extra author.url
        // (deep-merged onto the shared {name,email}), and the full portal
        // `interface` block, which has no base-field equivalent.
        codex: {
          description: codex.description,
          keywords: codex.keywords,
          author: { url: codexAuthor.url },
          interface: codex.interface,
        },
        // devin: shares codex's description and keyword set but keeps the
        // shared plain {name,email} author (no url).
        devin: {
          description: devin.description,
          keywords: devin.keywords,
        },
        // kimi: its own (shorter) description, codex's keyword set, its
        // tool-mapping skillInstructions, and its own (smaller) interface
        // block. Deliberately has no `repository` override -- see the
        // EXPECTED_DIFFERENCES entry for why that field still leaks through.
        kimi: {
          description: kimi.description,
          keywords: kimi.keywords,
          skillInstructions: kimi.skillInstructions,
          interface: kimi.interface,
        },
        // agents-marketplace: displayName override plus a full replacement
        // of the plugins array (deepMerge replaces arrays wholesale) to add
        // the category field the default descriptor never sets.
        'agents-marketplace': {
          interface: { displayName: agentsMarketplace.interface.displayName },
          plugins: agentsMarketplace.plugins,
        },
      },
    },
  }
}

if (!SUPERPOWERS_AVAILABLE) {
  console.log(
    `[dogfood] superpowers checkout not found at ${SUPERPOWERS_REPO} (or has no .git) -- skipping the dogfood test. Clone https://github.com/obra/superpowers there to run it locally.`,
  )
}

describe.skipIf(!SUPERPOWERS_AVAILABLE)('dogfood: regenerate superpowers hand-maintained manifests', () => {
  const originals: Record<ComparedFile, Record<string, unknown>> = {} as Record<ComparedFile, Record<string, unknown>>
  const generated: Record<ComparedFile, Record<string, unknown>> = {} as Record<ComparedFile, Record<string, unknown>>

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-dogfood-'))

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

  for (const file of COMPARED_FILES) {
    it(`regenerates ${file} to match the real manifest, modulo documented differences`, () => {
      const { generated: g, original: o } = withExpectedDifferencesRemoved(file, generated[file], originals[file])
      expect(g).toEqual(o)
    })
  }
})
