#!/usr/bin/env node
import { Command } from 'commander'
import { generate, TOOL_VERSION } from './generate.js'
import { validate } from './validate.js'
import { renderMatrix } from './matrix.js'
import { ConfigError } from './config.js'

const program = new Command()

program
  .name('everyharness')
  .description('Generate a coding-agent plugin for every harness from one config file')
  .version(TOOL_VERSION)

program
  .command('generate')
  .description('Generate per-harness plugin files from everyharness.yaml')
  .option('--dir <path>', 'plugin root directory', '.')
  .action((opts: { dir: string }) => {
    const result = generate(opts.dir)
    for (const warning of result.warnings) console.warn(`warning: ${warning}`)
    if (result.pruned.length > 0) {
      console.log(`Pruned ${result.pruned.length} stale file(s)`)
    }
    console.log(
      `Generated ${result.files.length} files for ${result.adaptersRun.length} harness(es): ${result.adaptersRun.join(', ')}`,
    )
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

program.parseAsync().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`error: ${error.message}`)
    process.exit(1)
  }
  console.error(error)
  process.exit(1)
})
