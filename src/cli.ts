#!/usr/bin/env node
import { Command } from 'commander'
import { generate, TOOL_VERSION } from './generate.js'
import { validate } from './validate.js'
import { renderMatrix } from './matrix.js'
import { init } from './init.js'
import { importPlugin } from './import.js'
import { runTest, DEFAULT_IMAGE } from './test-command.js'
import { bumpVersion, bumpCheck, bumpAudit, type BumpResult, type CheckResult, type AuditResult } from './bump.js'
import { ConfigError } from './config.js'

const LABEL_WIDTH = 45

function label(path: string, field: string): string {
  return `${path} (${field})`.padEnd(LABEL_WIDTH)
}

function printCheck(result: CheckResult): void {
  console.log('Version check:\n')
  for (const file of result.files) {
    console.log(`  ${label(file.path, file.field)}  ${file.version ?? 'MISSING'}`)
  }
  console.log(`  ${label('everyharness.yaml', 'version')}  ${result.configVersion}`)
  console.log('')
  for (const path of result.staleGenerated) {
    console.log(`generated file stale: ${path}`)
  }
  if (result.drift) console.log('DRIFT DETECTED — versions or generated files are out of sync')
  else console.log(`All declared files are in sync at ${result.configVersion}`)
}

function printAudit(result: AuditResult): void {
  console.log(`Audit: scanning repo for version string '${result.version}'...\n`)
  if (result.clean) {
    console.log('No undeclared files contain the version string. All clear.')
    return
  }
  console.log(`UNDECLARED files containing '${result.version}':`)
  for (const finding of result.findings) {
    console.log(`  ${finding.path}:${finding.line}: ${finding.text}`)
  }
  console.log(
    '\nReview the above — if they should be bumped, add them to release.files; if they should be skipped, add them to release.audit.exclude.',
  )
}

function printBump(result: BumpResult): void {
  console.log(`Bumping to ${result.newVersion}...\n`)
  for (const file of result.files) {
    if (file.status === 'skipped') console.log(`  SKIP (missing): ${file.path}`)
    else console.log(`  ${label(file.path, file.field)}  ${file.oldVersion} -> ${result.newVersion}`)
  }
  console.log(`  ${label('everyharness.yaml', 'version')}  ${result.configOldVersion} -> ${result.newVersion}`)
  console.log('')
  for (const warning of result.generate.warnings) console.warn(`warning: ${warning}`)
  console.log(
    `Regenerated ${result.generate.files.length} files for ${result.generate.adaptersRun.length} harness(es)`,
  )
  console.log('')
  printAudit(result.audit)
}

const program = new Command()

program
  .name('everyharness')
  .description('Generate a coding-agent plugin for every harness from one config file')
  .version(TOOL_VERSION)

program
  .command('init')
  .description('Scaffold a new plugin with everyharness.yaml and getting-started skill')
  .option('--dir <path>', 'plugin root directory', '.')
  .option('--force', 're-scaffold the config only (never deletes user files)', false)
  .action((opts: { dir: string; force: boolean }) => {
    const result = init(opts.dir, { force: opts.force })
    for (const path of result.created) console.log(`created: ${path}`)
    console.log(`Generated ${result.generated} files for initialization`)
    console.log('Next: edit everyharness.yaml, then re-run everyharness generate')
  })

program
  .command('import')
  .description('Convert a Claude-format plugin (.claude-plugin/plugin.json) into everyharness.yaml')
  .option('--dir <path>', 'plugin root directory', '.')
  .action((opts: { dir: string }) => {
    const result = importPlugin(opts.dir)
    for (const item of result.found) console.log(`found: ${item}`)
    for (const warning of result.warnings) console.warn(`warning: ${warning}`)
    console.log(
      'Wrote everyharness.yaml — review it, then run everyharness generate. Note: generate will report conflicts with your existing hand-maintained harness files (e.g. .claude-plugin/plugin.json); after reviewing, re-run with --force to let everyharness own them. If your repo has a README.md, adding <!-- everyharness:install:start --> and <!-- everyharness:install:end --> markers lets `generate` inject the install matrix.',
    )
  })

program
  .command('generate')
  .description('Generate per-harness plugin files from everyharness.yaml')
  .option('--dir <path>', 'plugin root directory', '.')
  .option('--force', 'overwrite existing files not created by everyharness', false)
  .action((opts: { dir: string; force: boolean }) => {
    const result = generate(opts.dir, undefined, { force: opts.force })
    for (const warning of result.warnings) console.warn(`warning: ${warning}`)
    if (result.pruned.length > 0) {
      for (const path of result.pruned) console.log(`pruned: ${path}`)
      console.log(`Pruned ${result.pruned.length} stale file(s)`)
    }
    console.log(
      `Generated ${result.files.length} files for ${result.adaptersRun.length} harness(es): ${result.adaptersRun.join(', ')}`,
    )
    if (result.readmeInjected) console.log('README.md install section updated')
  })

program
  .command('validate')
  .description('Check generated files for drift and schema violations')
  .option('--dir <path>', 'plugin root directory', '.')
  .action((opts: { dir: string }) => {
    const result = validate(opts.dir)
    for (const path of result.drift.modified) {
      console.error(`drift: ${path} was modified after generation (regenerate, or move the change into harnesses.<name>.manifest)`)
    }
    for (const path of result.drift.missing) {
      console.error(`drift: ${path} is recorded in the manifest but missing from disk (run \`everyharness generate\` to restore it)`)
    }
    for (const err of result.schemaErrors) console.error(`schema: ${err}`)
    if (!result.drift.clean) process.exit(3)
    if (result.schemaErrors.length > 0) process.exit(2)
    console.log('validate: clean')
  })

program
  .command('matrix')
  .description('Show which components each harness supports')
  .action(() => {
    process.stdout.write(renderMatrix())
  })

program
  .command('test')
  .description(
    'Run container-backed offline install checks against a generated plugin: parse every harness manifest, then really install the plugin into each harness CLI and assert it enumerates the skills',
  )
  .option('--dir <path>', 'plugin root directory', '.')
  .option('--image <ref>', 'container image to run checks in', DEFAULT_IMAGE)
  .action(async (opts: { dir: string; image: string }) => {
    const result = await runTest(opts.dir, { image: opts.image })
    if (result.exitCode !== 0) process.exit(result.exitCode)
  })

program
  .command('bump')
  .argument('[version]', 'new semver version to set across everyharness.yaml and declared release.files')
  .description(
    'Bump the plugin version and regenerate. Replaces per-repo bump scripts. ' +
      '--check reports drift (exit 3), --audit scans for undeclared version strings (exit 0). ' +
      'Give exactly one of <version>, --check, or --audit.',
  )
  .option('--check', 'report current versions and detect drift', false)
  .option('--audit', 'scan the repo for undeclared occurrences of the current version', false)
  .option('--dir <path>', 'plugin root directory', '.')
  .action((version: string | undefined, opts: { check: boolean; audit: boolean; dir: string }) => {
    const modes = [version !== undefined, opts.check, opts.audit].filter(Boolean).length
    if (modes !== 1) {
      throw new ConfigError('bump: give exactly one of <version>, --check, or --audit')
    }
    if (opts.check) {
      const result = bumpCheck(opts.dir)
      printCheck(result)
      if (result.drift) process.exit(3)
      return
    }
    if (opts.audit) {
      printAudit(bumpAudit(opts.dir))
      return
    }
    printBump(bumpVersion(opts.dir, version as string))
  })

program.parseAsync().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`error: ${error.message}`)
    process.exit(1)
  }
  console.error(error)
  process.exit(1)
})
