#!/usr/bin/env node
import { Command } from 'commander'
import { generate, TOOL_VERSION } from './generate.js'
import { validate } from './validate.js'
import { renderMatrix } from './matrix.js'
import { init } from './init.js'
import { importPlugin } from './import.js'
import { runTest, DEFAULT_IMAGE } from './test-command.js'
import { ConfigError } from './config.js'

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
      console.error(`drift: ${path} was modified after generation (regenerate, or move the change into everyharness.yaml overrides)`)
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

program.parseAsync().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`error: ${error.message}`)
    process.exit(1)
  }
  console.error(error)
  process.exit(1)
})
