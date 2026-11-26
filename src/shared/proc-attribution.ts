/**
 * Which running OS processes belong to which project (pure: no node, no electron).
 * Detected processes are never persisted; the user may stop a listed one (main/proc-stop.ts validates it).
 */

import { isInfra } from './proc-filter.ts'
import { indexOf, lineage } from './proc-tree.ts'

export { procLabel } from './proc-kind.ts'

export interface ProcEntry {
  pid: number
  ppid: number
  command: string
  /** unix only: process group, and the group in the foreground of its tty */
  pgid?: number
  tpgid?: number
  /** absent on Windows, or when the system does not tell */
  cwd?: string
  /** epoch ms; absent when the system does not tell */
  startedAt?: number
}

export interface ProcSnapshot {
  procs: ProcEntry[]
  /** listening TCP ports of each pid */
  ports: Map<number, number[]>
}

export type ProcOrigin = 'terminal' | 'thread' | 'external'

export interface DetectedProc {
  pid: number
  projectId: string
  origin: ProcOrigin
  command: string
  ports: number[]
  cwd?: string
  /** cwd relative to the project root; '' at the root; absent outside it or when unknown */
  folder?: string
  startedAt?: number
}

export interface ProcRoot {
  projectId: string
  path: string
}

export interface OwnedPids {
  /** integrated terminals: pty id (a project id, or something else like a login) → shell pid */
  terminals: Map<string, number>
  /** processes started from the panel's "+" button, which already lists them */
  managed: number[]
}

/** the job in the foreground of an integrated terminal, one entry each, when none of its members listens */
function foregroundJobs(snapshot: ProcSnapshot, byPid: Map<number, ProcEntry>, owned: OwnedPids): number[] {
  const shells = new Set(owned.terminals.values())
  const jobs = new Map<number, ProcEntry[]>()
  for (const p of snapshot.procs) {
    if (p.pgid === undefined || p.pgid !== p.tpgid || shells.has(p.pid)) continue
    if (!lineage(byPid, p.pid).some((a) => shells.has(a))) continue
    jobs.set(p.pgid, [...(jobs.get(p.pgid) ?? []), p])
  }
  return [...jobs].flatMap(([pgid, members]) => {
    if (members.some((m) => snapshot.ports.has(m.pid))) return []
    const inside = new Set(members.map((m) => m.pid))
    const leader = members.find((m) => m.pid === pgid) ?? members.find((m) => !inside.has(m.ppid))
    return leader ? [leader.pid] : []
  })
}

/** pids worth attributing: the ones listening, plus the terminals' foreground jobs */
export function candidatePids(snapshot: ProcSnapshot, owned: OwnedPids): number[] {
  const byPid = indexOf(snapshot)
  const listening = [...snapshot.ports.keys()].filter((pid) => byPid.has(pid))
  return [...listening, ...foregroundJobs(snapshot, byPid, owned)]
}

function normalizer(platform: string): (s: string) => string {
  return (s) => {
    const composed = s.normalize('NFC')
    const slashed = platform === 'win32' ? composed.replace(/\\/g, '/') : composed
    return platform === 'win32' || platform === 'darwin' ? slashed.toLowerCase() : slashed
  }
}

export function attributeProcs(
  snapshot: ProcSnapshot, roots: ProcRoot[], owned: OwnedPids, appPid: number, platform: string
): DetectedProc[] {
  const byPid = indexOf(snapshot)
  const norm = normalizer(platform)
  // longest first: in nested projects the inner one wins
  const folders = roots
    .map((r) => ({ id: r.projectId, dir: norm(r.path).replace(/\/+$/, '') }))
    .filter((r) => r.dir)
    .sort((a, b) => b.dir.length - a.dir.length)
  const known = new Set(roots.map((r) => r.projectId))
  const shells = new Map([...owned.terminals].filter(([id]) => known.has(id)).map(([id, pid]) => [pid, id]))
  const managed = new Set(owned.managed)

  const folderOf = (p: ProcEntry): string | undefined => {
    if (p.cwd !== undefined) {
      const cwd = norm(p.cwd)
      return folders.find((r) => cwd === r.dir || cwd.startsWith(`${r.dir}/`))?.id
    }
    const command = norm(p.command)
    return folders.find((r) => command.includes(`${r.dir}/`))?.id
  }

  const attribute = (pid: number): Pick<DetectedProc, 'projectId' | 'origin'> | undefined => {
    const chain = lineage(byPid, pid)
    if (pid === appPid || chain.some((a) => managed.has(a))) return
    const shell = chain.find((a) => shells.has(a))
    if (shell !== undefined) return { projectId: shells.get(shell) as string, origin: 'terminal' }
    // the app's own helpers have no project folder as cwd, so they fall out here
    const projectId = folderOf(byPid.get(pid) as ProcEntry)
    if (projectId === undefined) return
    return { projectId, origin: chain.includes(appPid) ? 'thread' : 'external' }
  }

  const rootDirs = new Map(roots.map((r) => [r.projectId, norm(r.path).replace(/\/+$/, '')]))
  const folderIn = (cwd: string, projectId: string): string | undefined => {
    const dir = rootDirs.get(projectId) as string
    const at = norm(cwd)
    if (at === dir) return ''
    if (!at.startsWith(`${dir}/`)) return
    // the original spelling: normalizing only changes case and separators
    const original = cwd.normalize('NFC')
    return (platform === 'win32' ? original.replace(/\\/g, '/') : original).slice(dir.length + 1)
  }
  const detail = (entry: ProcEntry, projectId: string): Pick<DetectedProc, 'cwd' | 'folder' | 'startedAt'> => {
    const folder = entry.cwd === undefined ? undefined : folderIn(entry.cwd, projectId)
    return {
      ...(entry.cwd !== undefined && { cwd: entry.cwd }),
      ...(folder !== undefined && { folder }),
      ...(entry.startedAt !== undefined && { startedAt: entry.startedAt })
    }
  }

  const shellPids = new Set(owned.terminals.values())
  const found = new Map<number, DetectedProc>()
  for (const pid of new Set(candidatePids(snapshot, owned))) {
    const owner = attribute(pid)
    const entry = byPid.get(pid) as ProcEntry
    if (!owner || isInfra(entry, byPid, appPid, shellPids)) continue
    const ports = [...new Set(snapshot.ports.get(pid) ?? [])].sort((a, b) => a - b)
    found.set(pid, { pid, ...owner, command: entry.command, ports, ...detail(entry, owner.projectId) })
  }

  // forked workers share their parent's sockets: one row is enough
  const repeats = (d: DetectedProc): boolean =>
    lineage(byPid, d.pid).slice(1).some((a) => {
      const parent = found.get(a)
      return !!parent && parent.projectId === d.projectId && parent.ports.join() === d.ports.join()
    })
  return [...found.values()].filter((d) => !repeats(d)).sort((a, b) => a.pid - b.pid)
}
