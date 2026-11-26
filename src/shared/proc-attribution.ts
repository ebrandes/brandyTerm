/**
 * Which running OS processes belong to which project (pure: no node, no electron).
 * Detected processes are read-only information: never persisted, never stopped.
 */

export interface ProcEntry {
  pid: number
  ppid: number
  command: string
  /** unix only: process group, and the group in the foreground of its tty */
  pgid?: number
  tpgid?: number
  /** absent on Windows, or when the system does not tell */
  cwd?: string
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

/** Windows reuses pids, so a parent chain may loop: it is walked once per pid, up to this depth */
const MAX_DEPTH = 64

/** the process itself, then its parents */
function lineage(byPid: Map<number, ProcEntry>, pid: number): number[] {
  const seen = new Set<number>()
  for (let at: number | undefined = pid; at !== undefined && at > 0 && seen.size < MAX_DEPTH; at = byPid.get(at)?.ppid) {
    if (seen.has(at)) break
    seen.add(at)
  }
  return [...seen]
}

const indexOf = (snapshot: ProcSnapshot) => new Map(snapshot.procs.map((p) => [p.pid, p]))

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

  const found = new Map<number, DetectedProc>()
  for (const pid of new Set(candidatePids(snapshot, owned))) {
    const owner = attribute(pid)
    if (!owner) continue
    const ports = [...new Set(snapshot.ports.get(pid) ?? [])].sort((a, b) => a - b)
    found.set(pid, { pid, ...owner, command: (byPid.get(pid) as ProcEntry).command, ports })
  }

  // forked workers share their parent's sockets: one row is enough
  const repeats = (d: DetectedProc): boolean =>
    lineage(byPid, d.pid).slice(1).some((a) => {
      const parent = found.get(a)
      return !!parent && parent.projectId === d.projectId && parent.ports.join() === d.ports.join()
    })
  return [...found.values()].filter((d) => !repeats(d)).sort((a, b) => a.pid - b.pid)
}

const INTERPRETERS = /^(node|nodejs|python[\d.]*|ruby|bun)(\.exe)?$/i
const MAX_LABEL = 60

const baseName = (s: string) => s.split(/[\\/]/).pop() || s

/** "…/bin/node …/astro/bin/astro.mjs preview" → "astro preview" */
export function procLabel(command: string): string {
  // ps does not quote paths, and this macOS folder has a space
  const whole = command.replace(/\/Application Support\//g, '/ApplicationSupport/')
  const words = (whole.match(/"[^"]*"|\S+/g) ?? []).map((w) => w.replace(/^"|"$/g, ''))
  if (words.length > 1 && INTERPRETERS.test(baseName(words[0])) && !words[1].startsWith('-')) words.shift()
  if (words.length) {
    const isPath = /[\\/]/.test(words[0])
    const name = baseName(words[0])
    words[0] = isPath ? name.replace(/\.(m|c)?js$|\.exe$/i, '') : name
  }
  const label = words.join(' ')
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label
}
