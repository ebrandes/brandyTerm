/**
 * `process:detected`: the processes and ports running for a project that the "+" button did not start.
 * `process:stop-detected`: stops one of them, after checking here that it may be stopped.
 */
import { realpathSync } from 'node:fs'
import { attributeProcs, type DetectedProc, type ProcRoot } from '../shared/proc-attribution.ts'
import type { Engine } from './engine.ts'
import type { StopResult } from '../shared/proc-stop-labels.ts'
import { createProcScanner } from './proc-scan.ts'
import { checkStoppable, stopTree, systemDeps } from './proc-stop.ts'
import { terminalPids } from './terminal.ts'
import { registry } from './rpc/registry.ts'
import { ruleOf } from './rpc/channels.ts'

/** the system reports resolved folders, so a project reached through a symlink must be resolved too */
function resolved(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

export function registerProcScanIpc(engine: Engine): void {
  const scan = createProcScanner(process.platform)
  /** what the panel was last given, per project: only these pids may be stopped */
  const shown = new Map<string, DetectedProc[]>()

  async function detect(projectId: string, fresh: boolean) {
    const roots: ProcRoot[] = engine.state.projects.flatMap((p) =>
      p.path && !p.demo ? [{ projectId: p.id, path: resolved(p.path) }] : [])
    if (!roots.some((r) => r.projectId === projectId)) return
    const owned = { terminals: terminalPids(), managed: engine.procs.pids() }
    const snapshot = await scan(owned, fresh)
    const list = attributeProcs(snapshot, roots, owned, process.pid, process.platform).filter((d) => d.projectId === projectId)
    return { owned, snapshot, list }
  }

  registry.add('process:detected', async (projectId: string): Promise<DetectedProc[]> => {
    const list = (await detect(projectId, false))?.list ?? []
    shown.set(projectId, list)
    return list
  }, ruleOf('process:detected'))

  registry.add('process:stop-detected', async (arg: { projectId: string; pid: number }): Promise<StopResult> => {
    const { projectId, pid } = arg ?? {}
    try {
      const now = await detect(projectId, true)
      if (!now) return { ok: false, error: 'projeto não encontrado' }
      const refusal = checkStoppable({
        pid, shown: shown.get(projectId) ?? [], fresh: now.list, appPid: process.pid, snapshot: now.snapshot
      })
      if (refusal) return { ok: false, error: refusal }
      const result = await stopTree(pid, now.snapshot, systemDeps())
      // so the next poll does not answer with the list from before
      await scan(now.owned, true).catch(() => {})
      return result
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }, ruleOf('process:stop-detected'))
}
