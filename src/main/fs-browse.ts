import { opendir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { FsEntry } from '../shared/types.ts'

/**
 * "@~/..." and "@/..." in the composer: one level of a directory anywhere on
 * disk, so the user can walk folder by folder. Paths keep what was typed
 * (including "~"), so the menu can insert them as they are.
 */

const READ_CAP = 200
const SHOW_CAP = 50

/** true when the mention text is an absolute or home-relative path */
export const isOutside = (query: string): boolean => query.startsWith('/') || query.startsWith('~/')

export async function browseDir(query: string): Promise<FsEntry[]> {
  const cut = query.lastIndexOf('/') + 1
  const typedDir = query.slice(0, cut)
  const seg = query.slice(cut).toLowerCase()
  const dir = resolve(typedDir.startsWith('~/') ? join(homedir(), typedDir.slice(2)) : typedDir)
  const found: { name: string; dir: boolean }[] = []
  try {
    const handle = await opendir(dir)
    let read = 0
    for await (const d of handle) {
      if (++read > READ_CAP) break
      const n = d.name.toLowerCase()
      // dotfiles only when asked for; then "." is a prefix, not a substring
      if (seg.startsWith('.') ? !n.startsWith(seg) : n.startsWith('.') || !n.includes(seg)) continue
      let isDir = d.isDirectory()
      if (d.isSymbolicLink()) isDir = await stat(join(dir, d.name)).then((s) => s.isDirectory(), () => false)
      found.push({ name: d.name, dir: isDir })
    }
  } catch {
    return [] // missing folder, not a folder, EACCES...
  }
  const prefix = (n: string) => (n.toLowerCase().startsWith(seg) ? 0 : 1)
  return found
    .sort((a, b) => Number(b.dir) - Number(a.dir) || prefix(a.name) - prefix(b.name) || a.name.localeCompare(b.name))
    .slice(0, SHOW_CAP)
    .map((f) => ({ path: `${typedDir}${f.name}${f.dir ? '/' : ''}`, kind: f.dir ? 'dir' : 'file' }))
}
