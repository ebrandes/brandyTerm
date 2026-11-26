/** `process:detected`: the processes and ports running for a project that the "+" button did not start. */
import { realpathSync } from 'node:fs'
import { attributeProcs, type DetectedProc, type ProcRoot } from '../shared/proc-attribution.ts'
import type { Engine } from './engine.ts'
import { createProcScanner } from './proc-scan.ts'
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
  registry.add('process:detected', async (projectId: string): Promise<DetectedProc[]> => {
    const roots: ProcRoot[] = engine.state.projects.flatMap((p) =>
      p.path && !p.demo ? [{ projectId: p.id, path: resolved(p.path) }] : [])
    if (!roots.some((r) => r.projectId === projectId)) return []
    const owned = { terminals: terminalPids(), managed: engine.procs.pids() }
    const snapshot = await scan(owned)
    return attributeProcs(snapshot, roots, owned, process.pid, process.platform).filter((d) => d.projectId === projectId)
  }, ruleOf('process:detected'))
}
