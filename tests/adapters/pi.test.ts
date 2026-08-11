import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildModel } from '../../src/model.js'
import { pi } from '../../src/adapters/pi.js'
import { opencode } from '../../src/adapters/opencode.js'
import { adapters, getAdapter } from '../../src/adapters/index.js'
import { GENERATED_BOOTSTRAP_PATH } from '../../src/bootstrap/generated.js'

const REPO_ROOT = process.cwd()
const model = buildModel('fixtures/kitchen-sink')

function tmpFixture(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'eh-pi-'))
  writeFileSync(join(dir, 'everyharness.yaml'), yaml)
  return dir
}

// Type-checks an emitted Pi extension file against a minimal stub of
// @earendil-works/pi-coding-agent, proving the generated TS is not just
// string-matched but actually compiles under strict+NodeNext -- the same
// settings this repo's own tsconfig.json uses. The stub declares per-event
// overloads (mirroring the real package's ~30 per-event-literal overloads,
// no string fallback) with distinct handler shapes per event, rather than
// a single `on(event: string, handler: (...args: any[]) => any): void`
// catch-all -- so a template regression (wrong event name, wrong handler
// argument shape, a typo'd property access) is caught the same way tsc
// would catch it against the real package, instead of silently passing
// because every handler argument was typed `any`.
function setUpTypeCheckDir(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'eh-pi-tsc-'))
  const stubDir = join(dir, 'node_modules', '@earendil-works', 'pi-coding-agent')
  mkdirSync(stubDir, { recursive: true })
  writeFileSync(
    join(stubDir, 'index.d.ts'),
    [
      'export interface PiMessage { role: string; content: unknown; timestamp?: number }',
      'export interface ContextEvent { messages: PiMessage[] }',
      'export interface ExtensionAPI {',
      "  on(event: 'resources_discover', handler: () => Promise<{ skillPaths: string[] }>): void",
      "  on(event: 'session_start', handler: () => Promise<void>): void",
      "  on(event: 'session_compact', handler: () => Promise<void>): void",
      "  on(event: 'agent_end', handler: () => Promise<void>): void",
      "  on(event: 'context', handler: (event: ContextEvent) => Promise<{ messages: PiMessage[] } | undefined | void>): void",
      '}',
      '',
    ].join('\n'),
  )
  writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', types: 'index.d.ts' }))
  // "type": "module" is required for NodeNext to parse `import.meta` in
  // ext.ts as ESM rather than erroring as if it were CommonJS.
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'eh-pi-tsc-fixture', type: 'module' }))
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ['node'],
        // Node builtin types ('node:fs' etc.) aren't declared by the stub
        // above; borrow this repo's own @types/node rather than installing
        // a second copy just for this check.
        typeRoots: [join(REPO_ROOT, 'node_modules', '@types')],
      },
      include: ['ext.ts'],
    }),
  )
  writeFileSync(join(dir, 'ext.ts'), source)
  return dir
}

function typeCheckExtension(source: string): void {
  const dir = setUpTypeCheckDir(source)
  execFileSync('npx', ['tsc', '--noEmit', '-p', dir], { cwd: REPO_ROOT, stdio: 'pipe' })
}

// Same type-check, but returns tsc's exit status instead of throwing --
// lets a test assert that a deliberately-broken variant FAILS to compile,
// proving the stub above actually has teeth rather than accepting anything.
function typeCheckExitStatus(source: string): number | null {
  const dir = setUpTypeCheckDir(source)
  try {
    execFileSync('npx', ['tsc', '--noEmit', '-p', dir], { cwd: REPO_ROOT, stdio: 'pipe' })
    return 0
  } catch (error) {
    return (error as { status: number | null }).status
  }
}

describe('adapter registry', () => {
  it('registers pi between opencode and hermes', () => {
    const names = adapters.map((a) => a.name)
    expect(names).toContain('pi')
    expect(getAdapter('pi')).toBe(pi)
    expect(names.indexOf('pi')).toBe(names.indexOf('opencode') + 1)
    expect(names.indexOf('pi')).toBe(names.indexOf('hermes') - 1)
  })
})

describe('pi adapter', () => {
  const result = pi.emit(model)
  const byPath = Object.fromEntries(result.files.map((f) => [f.path, f.content]))

  it('declares expected support levels', () => {
    expect(pi.support).toEqual({
      skills: 'full',
      commands: 'none',
      agents: 'none',
      hooks: 'none',
      mcp: 'none',
      bootstrap: 'full',
    })
  })

  it('emits package.json with the exact ground-truth shape', () => {
    expect(JSON.parse(byPath['package.json'])).toEqual({
      name: 'kitchen-sink',
      version: '0.1.0',
      description: 'Fixture plugin exercising every component type',
      author: { name: 'Prime Radiant', email: 'dev@prime-radiant.example' },
      license: 'MIT',
      repository: 'https://github.com/prime-radiant-inc/everyharness',
      type: 'module',
      main: './.opencode/plugins/kitchen-sink.js',
      pi: { extensions: ['./.pi/extensions/kitchen-sink.ts'], skills: ['./skills'] },
      keywords: ['fixture', 'pi-package'],
    })
  })

  it('emits a package.json byte-identical to the opencode adapter (Plan 2 dedupe contract)', () => {
    const opencodeResult = opencode.emit(model)
    const opencodePackageJson = opencodeResult.files.find((f) => f.path === 'package.json')!.content
    expect(byPath['package.json']).toBe(opencodePackageJson)
  })

  it('emits the extension TS with no leftover placeholders, the marker guard string, and skills-dir registration', () => {
    const ts = byPath['.pi/extensions/kitchen-sink.ts']
    expect(ts).toBeDefined()
    expect(ts).not.toMatch(/__[A-Z_]+__/)
    expect(ts).toContain('<plugin-bootstrap plugin="kitchen-sink">')
    expect(ts).toContain("resolve(extensionDir, '../..')")
    expect(ts).toContain("resolve(packageRoot, 'skills')")
    expect(ts.split('\n')[1]).toBe('// GENERATED by everyharness — edit everyharness.yaml instead')
  })

  it('registers all five pi.on( handlers in skill mode as explicit call sites', () => {
    const ts = byPath['.pi/extensions/kitchen-sink.ts']
    const registrations = ts.match(/pi\.on\(/g) ?? []
    // session_start and session_compact are each their own pi.on( call
    // site (not a for-of loop over an event-name array) -- the real
    // @earendil-works/pi-coding-agent's `on` has ~30 per-event-literal
    // overloads and no string fallback, so a loop passing a union-typed
    // event name fails tsc --strict with TS2769.
    expect(registrations).toHaveLength(5)
    expect(ts).toContain("pi.on('resources_discover'")
    expect(ts).toContain("pi.on('session_start'")
    expect(ts).toContain("pi.on('session_compact'")
    expect(ts).toContain("pi.on('agent_end'")
    expect(ts).toContain("pi.on('context'")
  })

  it('resolves the bootstrap path to the skill SKILL.md in skill mode', () => {
    const ts = byPath['.pi/extensions/kitchen-sink.ts']
    expect(ts).toContain("resolve(packageRoot, 'skills/using-kitchen-sink/SKILL.md')")
  })

  it('warns about commands, agents, hooks, and mcp', () => {
    expect(result.warnings).toEqual([
      'commands are not emitted for pi',
      'agents are not emitted for pi',
      'hooks are not emitted for pi',
      'mcp servers are not emitted for pi',
    ])
  })

  it('type-checks the emitted skill-mode extension under strict NodeNext', () => {
    expect(() => typeCheckExtension(byPath['.pi/extensions/kitchen-sink.ts'])).not.toThrow()
  })

  it('rejects a variant with a typo in the context event\'s messages property (stub has teeth)', () => {
    const ts = byPath['.pi/extensions/kitchen-sink.ts']
    const broken = ts.replaceAll('messages', 'messagesTYPO')
    expect(broken).not.toBe(ts)
    expect(typeCheckExitStatus(broken)).not.toBe(0)
  })
})

describe('pi adapter without commands/agents/hooks/mcp', () => {
  it('emits no warnings', () => {
    const dir = tmpFixture('name: plain\nversion: 1.0.0\ndescription: plain fixture\nbootstrap:\n  none: true\n')
    const plainModel = buildModel(dir)
    const result = pi.emit(plainModel)
    expect(result.warnings).toEqual([])
  })
})

describe('pi adapter with bootstrap.generate', () => {
  it('resolves the bootstrap path to the generated bootstrap.md', () => {
    const dir = tmpFixture('name: gen-demo\nversion: 1.0.0\ndescription: generate-mode fixture\nbootstrap:\n  generate: true\n')
    const genModel = buildModel(dir)
    const ts = pi.emit(genModel).files.find((f) => f.path === '.pi/extensions/gen-demo.ts')!.content
    expect(ts).toContain(`resolve(packageRoot, '${GENERATED_BOOTSTRAP_PATH}')`)
    expect(ts).not.toMatch(/__[A-Z_]+__/)
  })

  it('emits the generated bootstrap.md file itself, not just a reference to it', () => {
    const dir = tmpFixture('name: gen-demo\nversion: 1.0.0\ndescription: generate-mode fixture\nbootstrap:\n  generate: true\n')
    const genModel = buildModel(dir)
    const bootstrapMd = pi.emit(genModel).files.find((f) => f.path === GENERATED_BOOTSTRAP_PATH)
    expect(bootstrapMd?.content).toContain('# gen-demo plugin')
  })
})

describe('pi adapter with bootstrap: none', () => {
  const dir = tmpFixture('name: none-demo\nversion: 1.0.0\ndescription: bootstrap-none fixture\nbootstrap:\n  none: true\n')
  const noneModel = buildModel(dir)
  const ts = pi.emit(noneModel).files.find((f) => f.path === '.pi/extensions/none-demo.ts')!.content

  it('emits only the resources_discover registration', () => {
    expect(ts).not.toMatch(/__[A-Z_]+__/)
    expect(ts).toContain("pi.on('resources_discover'")
    expect(ts).not.toContain('session_start')
    expect(ts).not.toContain('session_compact')
    expect(ts).not.toContain('agent_end')
    expect(ts).not.toContain("pi.on('context'")
    expect(ts).not.toContain('cachedBootstrap')
    expect(ts).not.toContain('BOOTSTRAP_MARKER')
    expect((ts.match(/pi\.on\(/g) ?? []).length).toBe(1)
  })

  it('type-checks the emitted none-mode extension under strict NodeNext', () => {
    expect(() => typeCheckExtension(ts)).not.toThrow()
  })
})
