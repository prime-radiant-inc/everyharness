import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildModel } from '../src/model.js'
import { parseFrontmatter } from '../src/frontmatter.js'

const FIXTURE = 'fixtures/kitchen-sink'

describe('parseFrontmatter', () => {
  it('splits frontmatter and body', () => {
    const { data, body } = parseFrontmatter('---\nname: x\n---\nBody here\n')
    expect(data).toEqual({ name: 'x' })
    expect(body).toBe('Body here\n')
  })
  it('returns empty data when no frontmatter', () => {
    expect(parseFrontmatter('just text').data).toEqual({})
  })
})

describe('buildModel', () => {
  it('discovers skills with names and descriptions', () => {
    const model = buildModel(FIXTURE)
    const names = model.skills.map((s) => s.name).sort()
    expect(names).toEqual(['greeting', 'using-kitchen-sink'])
    const greeting = model.skills.find((s) => s.name === 'greeting')!
    expect(greeting.dir).toBe('skills/greeting')
    expect(greeting.description).toMatch(/friendly greeting/)
  })

  it('discovers commands and agents', () => {
    const model = buildModel(FIXTURE)
    expect(model.commands).toEqual([
      {
        name: 'ks-hello',
        path: 'commands/ks-hello.md',
        description: 'Say hello from the kitchen-sink fixture',
      },
    ])
    expect(model.agents[0]).toMatchObject({ name: 'ks-reviewer', path: 'agents/ks-reviewer.md' })
  })

  it('parses hooks and mcp JSON', () => {
    const model = buildModel(FIXTURE)
    expect(model.hooks).toHaveProperty('hooks.SessionStart')
    expect(model.mcp).toHaveProperty('mcpServers.ks-demo')
  })

  it('returns empty arrays for absent component dirs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-model-'))
    writeFileSync(join(dir, 'everyharness.yaml'), 'name: bare\nversion: 1.0.0\ndescription: bare\n')
    const model = buildModel(dir)
    expect(model.skills).toEqual([])
    expect(model.commands).toEqual([])
    expect(model.agents).toEqual([])
    expect(model.hooks).toBeUndefined()
    expect(model.mcp).toBeUndefined()
  })

  it('rejects a bootstrap skill that does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-model-'))
    writeFileSync(
      join(dir, 'everyharness.yaml'),
      'name: bad\nversion: 1.0.0\ndescription: bad\nbootstrap:\n  skill: nope\n',
    )
    expect(() => buildModel(dir)).toThrowError(/bootstrap skill "nope" not found/)
  })

  it('reports malformed hooks JSON as a ConfigError', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-model-'))
    writeFileSync(join(dir, 'everyharness.yaml'), 'name: bad-hooks\nversion: 1.0.0\ndescription: bad hooks\n')
    mkdirSync(join(dir, 'hooks'), { recursive: true })
    writeFileSync(join(dir, 'hooks', 'hooks.json'), '{oops')
    expect(() => buildModel(dir)).toThrowError(/not valid JSON/)
  })

  it('reports malformed mcp JSON as a ConfigError', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eh-model-'))
    writeFileSync(join(dir, 'everyharness.yaml'), 'name: bad-mcp\nversion: 1.0.0\ndescription: bad mcp\n')
    writeFileSync(join(dir, '.mcp.json'), '{oops')
    expect(() => buildModel(dir)).toThrowError(/not valid JSON/)
  })
})
