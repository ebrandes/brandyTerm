import { resolve, sep } from 'node:path'
import { qualityByTier, qualityRow } from '../shared/thread-quality.ts'
import type { Project, Thread } from '../shared/types.ts'
import type { KindRow, LedgerEntry, MonthReport, RtkRow, UsageRow } from '../shared/usage-report.ts'
import { compareSavers, verdictOf } from './usage-compare.ts'
import { monthOf } from './usage-ledger.ts'

/** The monthly report from the ledger and the threads (state plus archive). Pure. */

export interface ReportInput {
  month: string
  /** months that have a ledger file */
  ledgerMonths: string[]
  entries: LedgerEntry[]
  /** projects with all their threads, archived ones included */
  projects: Pick<Project, 'id' | 'name' | 'path' | 'threads'>[]
  rtk: RtkRow[] | null
}

const monthOfIso = (iso: string) => monthOf(new Date(iso))

export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return monthOf(new Date(y, m - 2, 1))
}

/** by id; runs without one (router, scan) by the folder they ran in, the deepest project winning */
function projectNamer(projects: ReportInput['projects']): (e: LedgerEntry) => string {
  const byId = new Map(projects.map((p) => [p.id, p.name]))
  const folders = projects
    .flatMap((p) => (p.path ? [{ path: resolve(p.path), name: p.name }] : []))
    .sort((a, b) => b.path.length - a.path.length)
  return (e) => {
    if (e.projectId) return byId.get(e.projectId) ?? 'projeto removido'
    const cwd = resolve(e.cwd)
    return folders.find((f) => cwd === f.path || cwd.startsWith(f.path + sep))?.name ?? 'fora de projetos'
  }
}

export function usageRows(entries: LedgerEntry[], nameOf: (e: LedgerEntry) => string): UsageRow[] {
  const rows = new Map<string, UsageRow>()
  for (const e of entries) {
    const project = nameOf(e)
    const model = e.model ?? 'padrão da CLI'
    const key = JSON.stringify([project, e.agent, model])
    const r = rows.get(key) ?? { project, agent: e.agent, model, runs: 0, input: 0, output: 0, cached: 0, costUsd: 0, rtkRuns: 0, teRuns: 0 }
    r.runs++
    r.input += e.input
    r.output += e.output
    r.cached += e.cached
    r.costUsd += e.costUsd ?? 0
    if (e.rtk) r.rtkRuns++
    if (e.te) r.teRuns++
    rows.set(key, r)
  }
  return [...rows.values()].sort((a, b) => a.project.localeCompare(b.project) || b.input + b.output - (a.input + a.output))
}

function kindRows(entries: LedgerEntry[]): KindRow[] {
  const rows = new Map<string, KindRow>()
  for (const e of entries) {
    const r = rows.get(e.kind) ?? { kind: e.kind, runs: 0, input: 0, output: 0, costUsd: 0 }
    r.runs++
    r.input += e.input
    r.output += e.output
    r.costUsd += e.costUsd ?? 0
    rows.set(e.kind, r)
  }
  return [...rows.values()].sort((a, b) => b.input + b.output - (a.input + a.output))
}

export function buildReport(input: ReportInput): MonthReport {
  const { month, entries } = input
  const all: Thread[] = input.projects.flatMap((p) => p.threads)
  const byId = new Map(all.map((t) => [t.id, t]))
  const inMonth = (m: string) => all.filter((t) => monthOfIso(t.createdAt) === m)
  const threads = inMonth(month)
  const before = previousMonth(month)
  const earlier = inMonth(before)
  // a month that starts after its first week cannot stand for a whole month
  const partial = !earlier.some((t) => new Date(t.createdAt).getDate() <= 7)
  const total = qualityRow('todas', threads, byId)
  const previous = { month: before, partial, total: qualityRow('todas', earlier, byId) }
  const months = new Set([month, ...input.ledgerMonths, ...all.map((t) => monthOfIso(t.createdAt))])
  return {
    month,
    months: [...months].sort().reverse(),
    ledgerSince: entries.map((e) => e.ts).sort()[0],
    usage: usageRows(entries, projectNamer(input.projects)),
    kinds: kindRows(entries),
    rtk: input.rtk,
    compare: compareSavers(threads, entries, byId),
    quality: { total, tiers: qualityByTier(threads, byId) },
    previous,
    verdict: verdictOf(total, previous.total, partial)
  }
}
