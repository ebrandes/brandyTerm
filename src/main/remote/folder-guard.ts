// Which folders a remote device may open as a project. Compares folder identity (dev:ino), never path strings:
// firmlinks, 8.3 short names and case variants all name the same folder under different strings. Pure: no Electron.
import { realpathSync, statSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { HIDDEN } from './host-filter.ts'

export const FORBIDDEN = 'Pasta não permitida'

/** `dev:ino` of the folder, or null when it cannot be read. */
export type Identity = (path: string) => string | null

export const fsIdentity: Identity = (p) => {
  try {
    const s = statSync(p, { bigint: true })
    return `${s.dev}:${s.ino}`
  } catch { return null }
}

/** `p` and every folder above it, up to the root. */
function chain(p: string): string[] {
  const out = [p]
  for (let cur = p, up = dirname(cur); up !== cur; cur = up, up = dirname(cur)) out.push(up)
  return out
}

/** Resolved first: a symlinked parent of a protected folder must enter its chain (stat alone only follows the last link). */
const resolved = (p: string): string => { try { return realpathSync(p) } catch { return p } }

const devOf = (id: string): string => id.slice(0, id.indexOf(':'))

export interface Protected {
  userData: string
  home: string
  /** folders of projects hidden from remote devices */
  hidden: string[]
}

/** Throws the user-facing message when `p` (an existing folder) must not become a remote project. */
export function assertOpenable(p: string, prot: Protected, identity: Identity = fsIdentity): void {
  const path = chain(p)
  if (path.length === 1) throw new Error(FORBIDDEN) // a filesystem root
  if (path.some(c => basename(c).startsWith('.'))) throw new Error(FORBIDDEN) // ~/.ssh, ~/.aws, ~/.claude...
  const ids = path.map(identity)
  const self = ids[0]
  if (self === null) throw new Error(FORBIDDEN)
  if (ids[1] !== null && devOf(ids[1]) !== devOf(self)) throw new Error(FORBIDDEN) // a mount point
  const mine = new Set(ids.filter((i): i is string => i !== null))
  // true when the protected folder is the candidate, inside it, or contains it (counting `inside` only when asked)
  const clash = (dir: string, insideOk: boolean): boolean => {
    const dirIds = chain(resolved(dir)).map(identity)
    if (dirIds[0] === null) return false
    if (dirIds.some(i => i === self)) return true // candidate is, or contains, the protected folder
    return !insideOk && mine.has(dirIds[0]) // protected folder is above (or is) the candidate
  }
  if (prot.hidden.some(h => clash(h, false))) throw new Error(HIDDEN)
  if (clash(prot.userData, false)) throw new Error(FORBIDDEN)
  if (clash(prot.home, true)) throw new Error(FORBIDDEN) // home itself and its parents; inside home is fine
}
