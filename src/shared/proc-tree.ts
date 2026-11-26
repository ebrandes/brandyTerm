/** Walking the process table (pure). */
import type { ProcEntry, ProcSnapshot } from './proc-attribution.ts'

/** Windows reuses pids, so a parent chain may loop: it is walked once per pid, up to this depth */
export const MAX_DEPTH = 64

export const indexOf = (snapshot: ProcSnapshot): Map<number, ProcEntry> => new Map(snapshot.procs.map((p) => [p.pid, p]))

/** the process itself, then its parents */
export function lineage(byPid: Map<number, ProcEntry>, pid: number): number[] {
  const seen = new Set<number>()
  for (let at: number | undefined = pid; at !== undefined && at > 0 && seen.size < MAX_DEPTH; at = byPid.get(at)?.ppid) {
    if (seen.has(at)) break
    seen.add(at)
  }
  return [...seen]
}

/** a "child" that started before its parent only points at a reused pid */
const olderThan = (child: ProcEntry, parent: ProcEntry | undefined): boolean =>
  child.startedAt !== undefined && parent?.startedAt !== undefined && child.startedAt < parent.startedAt

/** the process and everything under it, children always before their parents */
export function descendants(snapshot: ProcSnapshot, pid: number): number[] {
  const byPid = indexOf(snapshot)
  const children = new Map<number, number[]>()
  for (const p of snapshot.procs) {
    if (olderThan(p, byPid.get(p.ppid))) continue
    children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid])
  }
  const seen = new Set<number>()
  const out: number[] = []
  const walk = (at: number, depth: number): void => {
    if (seen.has(at) || depth >= MAX_DEPTH) return
    seen.add(at)
    for (const child of children.get(at) ?? []) walk(child, depth + 1)
    out.push(at)
  }
  walk(pid, 0)
  return out
}
