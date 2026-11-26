/**
 * Stops a process with everything under it, and decides what may be stopped. Signals go pid by pid,
 * never to a process group: a terminal job shares its group with things that are not in the tree.
 */
import { execFile } from 'node:child_process'
import type { DetectedProc, ProcSnapshot } from '../shared/proc-attribution.ts'
import type { StopResult } from '../shared/proc-stop-labels.ts'
import { descendants, indexOf, lineage } from '../shared/proc-tree.ts'

const POLL = 250
const GRACE = 4_000
const AFTER_FORCE = 1_000

export interface StopDeps {
  platform: string
  appPid: number
  kill: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void
  alive: (pid: number) => boolean
  /** must not reject on a non-zero exit: `alive` tells what happened */
  run: (file: string, args: string[]) => Promise<void>
  sleep: (ms: number) => Promise<void>
}

const codeOf = (e: unknown): string | undefined => (e as NodeJS.ErrnoException)?.code

export const systemDeps = (appPid: number = process.pid): StopDeps => ({
  platform: process.platform,
  appPid,
  kill: (pid, signal) => void process.kill(pid, signal),
  alive: (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (e) {
      return codeOf(e) !== 'ESRCH'
    }
  },
  run: (file, args) => new Promise((resolve) => execFile(file, args, { windowsHide: true, timeout: 5_000 }, () => resolve())),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
})

export const taskkillArgs = (pid: number, force: boolean): string[] => ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])]

/** why the app forbids signaling this pid, or undefined */
function protectedReason(pid: number, appPid: number, snapshot: ProcSnapshot): string | undefined {
  if (!Number.isInteger(pid) || pid <= 1) return 'PID inválido'
  if (pid === appPid) return 'este é o próprio BrandyTerm'
  if (lineage(indexOf(snapshot), appPid).includes(pid)) return 'o BrandyTerm roda dentro deste processo'
  if (descendants(snapshot, pid).includes(appPid)) return 'o BrandyTerm está na árvore deste processo'
}

export interface StopCheck {
  pid: number
  /** the list the panel was last given */
  shown: DetectedProc[]
  /** the list as it is now, from `snapshot` */
  fresh: DetectedProc[]
  appPid: number
  snapshot: ProcSnapshot
}

/** why this pid must not be stopped, or undefined when it may */
export function checkStoppable({ pid, shown, fresh, appPid, snapshot }: StopCheck): string | undefined {
  const reason = protectedReason(pid, appPid, snapshot)
  if (reason) return reason
  const listed = shown.find((d) => d.pid === pid)
  if (!listed) return 'o processo não está na lista exibida'
  const now = fresh.find((d) => d.pid === pid)
  if (!now) return 'o processo não está mais rodando'
  const restarted = listed.startedAt !== undefined && now.startedAt !== undefined && listed.startedAt !== now.startedAt
  if (restarted || listed.command !== now.command) return 'o PID agora é de outro processo'
}

/** waits until all are gone or the time is up; returns who is left */
async function survivors(pids: number[], ms: number, deps: StopDeps): Promise<number[]> {
  let left = pids.filter(deps.alive)
  for (let waited = 0; left.length && waited < ms; waited += POLL) {
    await deps.sleep(POLL)
    left = left.filter(deps.alive)
  }
  return left
}

export async function stopTree(pid: number, snapshot: ProcSnapshot, deps: StopDeps): Promise<StopResult> {
  const reason = protectedReason(pid, deps.appPid, snapshot)
  if (reason) return { ok: false, error: reason }
  const spared = new Set(lineage(indexOf(snapshot), deps.appPid))
  const tree = descendants(snapshot, pid).filter((p) => p > 1 && !spared.has(p))

  const refused = new Map<number, string>()
  const signal = (target: number, name: 'SIGTERM' | 'SIGKILL') => {
    try {
      deps.kill(target, name)
    } catch (e) {
      if (codeOf(e) !== 'ESRCH') refused.set(target, codeOf(e) === 'EPERM' ? 'sem permissão' : String(e))
    }
  }

  const windows = deps.platform === 'win32'
  // without /F console programs often refuse: that shows up as survivors
  if (windows) await deps.run('taskkill', taskkillArgs(pid, false))
  else for (const target of tree) signal(target, 'SIGTERM')

  const stubborn = await survivors(tree, GRACE, deps)
  if (!stubborn.length) return { ok: true, forced: false }

  if (windows) {
    // the root first: its /T takes the rest with it
    for (const target of [...stubborn].reverse()) {
      if (deps.alive(target)) await deps.run('taskkill', taskkillArgs(target, true))
    }
  } else for (const target of stubborn) signal(target, 'SIGKILL')

  const left = await survivors(stubborn, AFTER_FORCE, deps)
  if (!left.length) return { ok: true, forced: true }
  const why = left.map((p) => refused.get(p)).find(Boolean)
  return { ok: false, error: `${why ?? 'o processo continua rodando'} (PID ${left.join(', ')})` }
}
