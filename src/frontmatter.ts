import { parse } from 'yaml'

export function parseFrontmatter(src: string): {
  data: Record<string, unknown>
  body: string
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src)
  if (!m) return { data: {}, body: src }
  const data = (parse(m[1]) as Record<string, unknown>) ?? {}
  return { data, body: src.slice(m[0].length) }
}
