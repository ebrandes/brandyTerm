// What a remote device may read inside a visible project: never a hidden project's folder, the app's data or a
// dot-named file or folder, even when a visible project contains them. Remote calls only (the host server runs
// it around every call); the window's own IPC is unchanged. Folder identity (dev:ino) as in folder-guard.ts.
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import type { AppState, FsEntry } from '../../shared/types.ts'
import { SCOPED, projectOf } from '../../shared/remote/scope.ts'
import { resolveInside } from '../artifact-read.ts'
import { projectDirName } from '../attachment-scope.ts'
import { browseTarget } from '../fs-browse.ts'
import { FORBIDDEN, chain, fsIdentity, resolved, type Identity } from './folder-guard.ts'
import { HIDDEN } from './host-filter.ts'

export interface RemoteGuard {
  /** throws the user-facing message when the call names a protected file or folder */
  before(channel: string, arg: unknown, state: AppState): void
  /** the result without protected entries (fs:list, fs:browse); anything else unchanged */
  after(channel: string, arg: unknown, result: unknown, state: AppState): unknown
}

export interface GuardDeps {
  /** app.getPath('userData'): state, trust store and keys live there */
  userData: () => string
  /** <userData>/attachments */
  attachmentsRoot: () => string
  home?: () => string
  identity?: Identity
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** a component named `.x` (`.env`, `.git/`, `.ssh/`): never read remotely */
const dotted = (path: string): boolean => path.split(/[\\/]/).some(c => c.startsWith('.'))

/** dev:ino of each protected folder → the message a remote device gets when a path enters it */
function protectedIds(state: AppState, userData: string, id: Identity): Map<string, string> {
  const out = new Map<string, string>()
  const add = (p: string, msg: string): void => {
    const i = id(resolved(p))
    if (i) out.set(i, msg)
  }
  for (const p of state.projects) if (p.remoteHidden && p.path) add(p.path, HIDDEN)
  add(userData, FORBIDDEN)
  return out
}

/** The message for `abs` when its folder chain (up to `stop`, else to the filesystem root) enters a protected folder. */
function verdict(abs: string, prot: Map<string, string>, id: Identity, stop?: string): string | null {
  for (const c of chain(abs)) {
    const hit = prot.get(id(c) ?? '')
    if (hit) return hit
    if (c === stop) break
  }
  return null
}

const memo = (id: Identity): Identity => {
  const seen = new Map<string, string | null>()
  return p => {
    if (!seen.has(p)) seen.set(p, id(p))
    return seen.get(p) ?? null
  }
}

export function readGuard(deps: GuardDeps): RemoteGuard {
  const home = deps.home ?? homedir
  const baseId = deps.identity ?? fsIdentity

  /** Folder a path-carrying call reads from. Attachments live inside userData by design: checked up to their folder only. */
  const rootFor = (channel: string, arg: unknown, state: AppState): { root: string; stopAtRoot: boolean } | null => {
    const pid = projectOf(channel, arg)
    if (pid === null) return null
    if (channel === 'attach:read') return { root: join(deps.attachmentsRoot(), projectDirName(pid)), stopAtRoot: true }
    const p = state.projects.find(x => x.id === pid)
    return p && !p.demo && p.path ? { root: p.path, stopAtRoot: false } : null
  }

  /** a scoped call that names a file (`{ projectId, path }`): the file must not sit in a protected folder */
  const checkFile = (channel: string, arg: Record<string, unknown>, state: AppState): void => {
    const r = rootFor(channel, arg, state)
    const abs = r && resolveInside(r.root, String(arg.path))
    if (!r || !abs) return // missing or outside the folder: the handler answers as for any missing file
    const realRoot = resolved(r.root)
    const id = memo(baseId)
    if (dotted(relative(realRoot, abs))) throw new Error(FORBIDDEN)
    const v = verdict(abs, protectedIds(state, deps.userData(), id), id, r.stopAtRoot ? realRoot : undefined)
    if (v) throw new Error(v)
  }

  /** the folder fs:browse lists: not inside a protected or dot-named folder */
  const checkBrowse = (arg: unknown, state: AppState): void => {
    const dir = resolved(browseTarget(String(arg ?? '~/'), home()).dir)
    if (dotted(dir)) throw new Error(FORBIDDEN)
    const id = memo(baseId)
    const v = verdict(dir, protectedIds(state, deps.userData(), id), id)
    if (v) throw new Error(v)
  }

  /** fs:list entries are relative to the project folder; any component that is protected or dot-named drops the entry */
  const filterList = (arg: unknown, list: FsEntry[], state: AppState): FsEntry[] => {
    const pid = isObj(arg) ? projectOf('fs:list', arg) : null
    const p = pid === null ? undefined : state.projects.find(x => x.id === pid)
    if (!p?.path) return []
    let realRoot: string
    try { realRoot = realpathSync(p.path) } catch { return [] }
    const id = memo(baseId)
    const prot = protectedIds(state, deps.userData(), id)
    if (verdict(realRoot, prot, id)) return []
    return list.filter(e => {
      const parts = String(e.path).split('/').filter(Boolean)
      if (parts.some(c => c.startsWith('.'))) return false
      let cur = realRoot
      for (const c of parts) {
        cur = join(cur, c)
        if (prot.has(id(cur) ?? '')) return false
      }
      return true
    })
  }

  /** fs:browse entries are one level of `dir`: protected and dot-named folders are left out */
  const filterBrowse = (arg: unknown, list: FsEntry[], state: AppState): FsEntry[] => {
    const { typedDir, dir } = browseTarget(String(arg ?? '~/'), home())
    const id = memo(baseId)
    const prot = protectedIds(state, deps.userData(), id)
    return list.filter(e => {
      const name = String(e.path).slice(typedDir.length).replace(/\/$/, '')
      return !!name && !name.startsWith('.') && !prot.has(id(join(dir, name)) ?? '')
    })
  }

  return {
    before(channel, arg, state) {
      if (channel === 'fs:browse') return checkBrowse(arg, state)
      if (SCOPED[channel] && isObj(arg) && typeof arg.path === 'string') checkFile(channel, arg, state)
    },
    after(channel, arg, result, state) {
      if (!Array.isArray(result)) return result
      if (channel === 'fs:list') return filterList(arg, result as FsEntry[], state)
      if (channel === 'fs:browse') return filterBrowse(arg, result as FsEntry[], state)
      return result
    }
  }
}
