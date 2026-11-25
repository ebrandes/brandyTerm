import { execFile } from 'node:child_process'
import { lstatSync, readdirSync, realpathSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { registry } from './rpc/registry.ts'
import { ruleOf } from './rpc/channels.ts'
import type { FsEntry } from '../shared/types.ts'
import { inside } from './paths.ts'
import { browseDir, isOutside } from './fs-browse.ts'

/**
 * Project files and folders offered after "@" in the composer. The renderer
 * only sends a projectId and a query; the query filters a list built here and
 * is never joined to a path (except for "@~/" and "@/", see fs-browse.ts).
 */

const LIMIT = 50
const MAX_DEPTH = 6
const MAX_SCAN = 20_000
const TTL = 15_000
const SKIP = new Set(['node_modules', '.git', 'out', 'dist'])
const cache = new Map<string, { at: number; list: FsEntry[] }>()
const run = promisify(execFile)
const skipped = (rel: string) => rel.split('/').some((s) => SKIP.has(s))

/** git respects .gitignore exactly (tracked + untracked, not ignored); folders come from the file paths */
async function fromGit(root: string): Promise<FsEntry[] | null> {
  try {
    const args = ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard']
    const { stdout } = await run('git', args, { maxBuffer: 32 << 20, timeout: 4000 })
    const files = [...new Set(stdout.split('\0'))].filter((f) => f && !skipped(f)).slice(0, MAX_SCAN)
    const dirs = new Set<string>()
    for (const f of files) for (let i = f.indexOf('/'); i > 0; i = f.indexOf('/', i + 1)) dirs.add(f.slice(0, i + 1))
    return [...[...dirs].map((path) => ({ path, kind: 'dir' as const })), ...files.map((path) => ({ path, kind: 'file' as const }))]
  } catch {
    return null
  }
}

/** fallback for folders without git: depth-limited walk, never follows symlinks */
function walk(root: string): FsEntry[] {
  const out: FsEntry[] = []
  const go = (dir: string, depth: number) => {
    let list
    try {
      list = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of list) {
      if (out.length >= MAX_SCAN || SKIP.has(d.name)) continue
      const rel = relative(root, join(dir, d.name)).split(sep).join('/')
      if (d.isDirectory()) {
        out.push({ path: `${rel}/`, kind: 'dir' })
        if (depth < MAX_DEPTH) go(join(dir, d.name), depth + 1)
      } else if (d.isFile() || d.isSymbolicLink()) out.push({ path: rel, kind: 'file' })
    }
  }
  go(root, 0)
  return out
}

/** prefix of the basename, prefix of the path, substring, letters in order (same idea as matchCommands) */
export function rank(list: FsEntry[], q: string): FsEntry[] {
  const query = q.toLowerCase()
  const score = (p: string) => {
    const n = p.toLowerCase()
    const base = n.replace(/\/$/, '').split('/').pop() ?? n
    if (!query) return n.split('/').filter(Boolean).length // short paths first
    if (base.startsWith(query)) return 0
    if (n.startsWith(query)) return 1
    if (n.includes(query)) return 2
    let i = 0
    for (const ch of n) if (ch === query[i]) i++
    return i === query.length ? 3 : -1
  }
  return list
    .map((e) => ({ e, s: score(e.path) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.e.path.length - b.e.path.length)
    .map((x) => x.e)
}

/** drops symlinks (and folders) that resolve outside the project */
function safe(realRoot: string, e: FsEntry): boolean {
  try {
    const abs = join(realRoot, e.path)
    return lstatSync(abs).isSymbolicLink() || e.kind === 'dir' ? inside(realRoot, realpathSync(abs)) : inside(realRoot, abs)
  } catch {
    return false
  }
}

export async function listFiles(root: string, query: string): Promise<FsEntry[]> {
  query = query.slice(0, 500)
  if (isOutside(query)) return browseDir(query)
  let realRoot: string
  try {
    realRoot = realpathSync(root)
  } catch {
    return []
  }
  let hit = cache.get(realRoot)
  if (!hit || Date.now() - hit.at > TTL) cache.set(realRoot, (hit = { at: Date.now(), list: (await fromGit(realRoot)) ?? walk(realRoot) }))
  const out: FsEntry[] = []
  for (const e of rank(hit.list, query)) {
    if (safe(realRoot, e)) out.push(e)
    if (out.length >= LIMIT) break
  }
  return out
}

export function registerFsIpc(rootOf: (projectId: string) => string | null): void {
  registry.add('fs:list', async (a: { projectId: string; query: string }) => {
    const root = rootOf(String(a?.projectId))
    return root ? listFiles(root, String(a?.query ?? '')) : []
  }, ruleOf('fs:list'))
}
