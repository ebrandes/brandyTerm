import { readdirSync } from 'node:fs'
import { registry } from './rpc/registry.ts'
import { ruleOf } from './rpc/channels.ts'
import type { Engine } from './engine.ts'
import { readArchive } from './archive.ts'
import { rtkBin } from './rtk.ts'
import { rtkRows } from './rtk-gain.ts'
import { buildReport } from './usage-build.ts'
import { monthOf, readLedger } from './usage-ledger.ts'

function ledgerMonths(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((f) => /^(\d{4}-\d{2})\.jsonl$/.exec(f)?.[1] ?? [])
  } catch {
    return []
  }
}

/** The monthly report, computed on demand from this machine's files. */
export function registerUsageIpc(engine: Engine, usageDir: string, archiveDir: string): void {
  registry.add('usage:report', async (asked?: unknown) => {
    const month = typeof asked === 'string' && /^\d{4}-\d{2}$/.test(asked) ? asked : monthOf(new Date())
    const projects = engine.state.projects.filter((p) => !p.demo).map((p) => {
      const inState = new Set(p.threads.map((t) => t.id))
      const archived = readArchive(archiveDir, p.id).filter((t) => !inState.has(t.id))
      return { id: p.id, name: p.name, path: p.path, threads: [...p.threads, ...archived] }
    })
    const bin = rtkBin()
    return buildReport({
      month,
      ledgerMonths: ledgerMonths(usageDir),
      entries: readLedger(usageDir, month),
      projects,
      rtk: bin ? await rtkRows(bin, projects, month) : null
    })
  }, ruleOf('usage:report'))
}
