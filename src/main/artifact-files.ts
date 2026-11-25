import { realpathSync } from 'node:fs'
import { dirname, basename, join, relative, resolve } from 'node:path'
import { inside } from './paths.ts'
import type { ThreadFile } from '../shared/types.ts'

/** Files a thread created or edited, shown as artifact cards. Pure: no Electron here. */

export type FileOp = ThreadFile['op']

/** most recent files kept per thread */
const MAX_FILES = 50

const WRITE_TOOLS = new Set(['Write'])
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit'])

/** The file a Claude tool call writes, if any. */
export function fileFromTool(name: string, input: any): { path: string; op: FileOp } | null {
  const op: FileOp | null = WRITE_TOOLS.has(name) ? 'write' : EDIT_TOOLS.has(name) ? 'edit' : null
  if (!op) return null
  const path = input?.file_path ?? input?.notebook_path
  return typeof path === 'string' && path ? { path, op } : null
}

/** The files a Codex `file_change` item touched; deletions make no card. */
export function filesFromCodex(item: any): { path: string; op: FileOp }[] {
  if (item?.status === 'failed') return []
  const changes = Array.isArray(item?.changes) ? item.changes : []
  return changes
    .filter((c: any) => typeof c?.path === 'string' && c.path && c.kind !== 'delete')
    .map((c: any) => ({ path: c.path as string, op: c.kind === 'add' ? 'write' : 'edit' }))
}

/** Adds a file to the thread's list as a path relative to `root`; paths outside it are ignored. */
export function addThreadFile(list: ThreadFile[], root: string, abs: string, op: FileOp, at: string): ThreadFile[] {
  const r = resolve(root)
  const p = resolve(r, abs)
  // the agent may report the physical path of a symlinked project (or the other way around)
  const realRoot = real(r)
  const target = inside(r, p) ? [r, p] : inside(realRoot, real(p)) ? [realRoot, real(p)] : null
  if (!target) return list
  const path = relative(target[0], target[1]).replace(/\\/g, '/')
  const next = [...list.filter((f) => f.path !== path), { path, op, at }]
  return next.length > MAX_FILES ? next.slice(next.length - MAX_FILES) : next
}

/** real path of `p`; for a file that is gone, the real path of its folder plus its name */
function real(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    try {
      return join(realpathSync(dirname(p)), basename(p))
    } catch {
      return p
    }
  }
}
