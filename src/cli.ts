#!/usr/bin/env node
import { Command } from 'commander'
import { generate, TOOL_VERSION } from './generate.js'
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
    console.log(
      `Generated ${result.files.length} files for ${result.adaptersRun.length} harness(es): ${result.adaptersRun.join(', ')}`,
    )
  })

program.parseAsync().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`error: ${error.message}`)
    process.exit(1)
  }
  console.error(error)
  process.exit(1)
})
