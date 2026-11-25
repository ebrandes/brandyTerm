import { isAbsolute, relative, resolve } from 'node:path'
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
  const changes = Array.isArray(item?.changes) ? item.changes : []
  return changes
    .filter((c: any) => typeof c?.path === 'string' && c.path && c.kind !== 'delete')
    .map((c: any) => ({ path: c.path as string, op: c.kind === 'add' ? 'write' : 'edit' }))
}

/** Adds a file to the thread's list as a path relative to `root`; paths outside it are ignored. */
export function addThreadFile(list: ThreadFile[], root: string, abs: string, op: FileOp, at: string): ThreadFile[] {
  const rel = relative(resolve(root), resolve(root, abs))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return list
  const path = rel.replace(/\\/g, '/')
  const next = [...list.filter((f) => f.path !== path), { path, op, at }]
  return next.length > MAX_FILES ? next.slice(next.length - MAX_FILES) : next
}
