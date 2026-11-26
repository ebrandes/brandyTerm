import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LedgerEntry } from '../shared/usage-report.ts'
import type { AgentId } from '../shared/types.ts'
import type { RunOpts } from './adapters/types.ts'
import type { RunResult } from './run.ts'
import { diagLog } from './diag-log.ts'
import { rtkBin } from './rtk.ts'
import { codexRtkHook } from './tool-health.ts'

/**
 * One line per agent run in `<userData>/usage/YYYY-MM.jsonl` (local month). The totals the app
 * keeps are cumulative and undated; this is what the monthly report reads. Nothing leaves the machine.
 */

let root: string | null = null

/** Set at app start; unset (tests, scripts) nothing is written. */
export function configureLedger(dir: string | null): void {
  root = dir
}

const fileOf = (dir: string, month: string) => join(dir, `${month}.jsonl`)

export function monthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Which savers were actually in this run (not merely installed). */
export function activeTools(agent: AgentId, opts: RunOpts, probe = { rtkBin, codexRtkHook }): { rtk: boolean; te: boolean } {
  if (agent === 'claude') {
    // the coordinator and other pure-text runs have no shell for RTK to compress
    const rtk = opts.tools !== 'none' && !!probe.rtkBin()
    // plugins.ts only hands over a TokenEconomizer copy that has its library
    const te = !!opts.plugins?.some((dir) => dir.split(/[\\/]/).includes('tokeneconomizer'))
    return { rtk, te }
  }
  return { rtk: agent === 'codex' && probe.codexRtkHook() === 'approved', te: false }
}

export function entryFor(agent: AgentId, opts: RunOpts, r: RunResult, now = new Date()): Omit<LedgerEntry, 'rtk' | 'te'> {
  const u = r.usage
  return {
    ts: now.toISOString(),
    cwd: opts.cwd,
    projectId: opts.tag?.projectId,
    threadId: opts.tag?.threadId,
    kind: opts.tag?.kind ?? 'other',
    agent,
    model: r.model ?? opts.model,
    effort: opts.effort,
    tier: opts.tag?.tier,
    // Codex counts cached tokens inside its input; Claude reports them apart
    input: agent === 'codex' ? Math.max(0, u.input - u.cached) : u.input,
    output: u.output,
    cached: u.cached,
    costUsd: u.costUsd || undefined,
    ok: !!r.done?.ok
  }
}

/** Appends the run. A failure here must never break the run it describes. */
export function recordRun(agent: AgentId, opts: RunOpts, r: RunResult): void {
  if (!root) return
  try {
    const now = new Date()
    const entry: LedgerEntry = { ...entryFor(agent, opts, r, now), ...activeTools(agent, opts) }
    mkdirSync(root, { recursive: true })
    appendFileSync(fileOf(root, monthOf(now)), JSON.stringify(entry) + '\n', { mode: 0o600 })
  } catch (e) {
    diagLog('usage', 'warn', 'não gravou o consumo', { error: (e as Error).message })
  }
}

/** The month's entries; a line cut by a crash is skipped. */
export function readLedger(dir: string, month: string): LedgerEntry[] {
  if (!/^\d{4}-\d{2}$/.test(month)) return []
  let text: string
  try {
    text = readFileSync(fileOf(dir, month), 'utf8')
  } catch {
    return []
  }
  return text.split('\n').flatMap((line) => {
    if (!line) return []
    try {
      return [JSON.parse(line) as LedgerEntry]
    } catch {
      return []
    }
  })
}
