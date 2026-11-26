import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SKIP = new Set(['node_modules', '.git'])
const MAX_DEPTH = 6

function declared(pluginDir: string): string[] | null {
  try {
    const raw = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'))
    if (!Array.isArray(raw?.skills)) return null
    return raw.skills.filter((s: unknown): s is string => typeof s === 'string')
  } catch {
    return null
  }
}

function walk(dir: string, depth: number): number {
  if (depth > MAX_DEPTH) return 0
  if (existsSync(join(dir, 'SKILL.md'))) return 1
  let n = 0
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue
    if (e.isDirectory() || e.isSymbolicLink()) n += walk(join(dir, e.name), depth + 1)
  }
  return n
}

/** Skills in a plugin: plugin.json `skills[]` when declared, else every dir under skills/ with a SKILL.md. */
export function countSkills(pluginDir: string): number {
  const list = declared(pluginDir)
  if (list) return list.filter((rel) => existsSync(join(resolve(pluginDir, rel), 'SKILL.md'))).length
  const root = join(pluginDir, 'skills')
  if (!existsSync(root)) return 0
  let n = 0
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    if (e.isDirectory() || e.isSymbolicLink()) n += walk(join(root, e.name), 1)
  }
  return n
}
