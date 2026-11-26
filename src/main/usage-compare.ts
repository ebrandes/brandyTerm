import { percent, qualityRow, tierOf, isFinished } from '../shared/thread-quality.ts'
import type { Thread } from '../shared/types.ts'
import type { CompareRow, LedgerEntry, QualityRow, SaverId, Verdict } from '../shared/usage-report.ts'

/** The two readings that tell whether anything was saved: with × without a tool, and month × month. */

export const MIN_SIDE = 5
export const MIN_MONTH = 10
const SPEND_TOLERANCE = 0.05
const QUALITY_TOLERANCE = 2

/**
 * Splits finished threads of the same agent and tier by whether every work run had the tool or
 * none did (mixed ones are left out). Only pairs with at least one thread on each side are listed.
 */
export function compareSavers(threads: Thread[], entries: LedgerEntry[], byId: Map<string, Thread>): CompareRow[] {
  const runs = new Map<string, LedgerEntry[]>()
  for (const e of entries) {
    if (!e.threadId || (e.kind !== 'work' && e.kind !== 'plan')) continue
    const list = runs.get(e.threadId)
    if (list) list.push(e)
    else runs.set(e.threadId, [e])
  }
  const rows: CompareRow[] = []
  for (const tool of ['rtk', 'te'] as SaverId[]) {
    const groups = new Map<string, { with: Thread[]; without: Thread[] }>()
    for (const t of threads.filter(isFinished)) {
      const own = runs.get(t.id)
      if (!own) continue
      const on = own.filter((e) => e[tool]).length
      if (on && on < own.length) continue
      const key = `${t.agent}|${tierOf(t) ?? 'sem tier'}`
      const g = groups.get(key) ?? { with: [], without: [] }
      g[on ? 'with' : 'without'].push(t)
      groups.set(key, g)
    }
    for (const [key, g] of groups) {
      if (!g.with.length || !g.without.length) continue
      const [agent, tier] = key.split('|') as [Thread['agent'], string]
      rows.push({
        tool,
        agent,
        tier,
        with: qualityRow(tier, g.with, byId),
        without: qualityRow(tier, g.without, byId),
        enough: g.with.length >= MIN_SIDE && g.without.length >= MIN_SIDE
      })
    }
  }
  return rows
}

/** Gain only when spend drops without worse quality, or quality rises at the same spend. */
export function verdictOf(now: QualityRow, before: QualityRow, partial: boolean): Verdict {
  const a = now.tokensPerResolved
  const b = before.tokensPerResolved
  if (now.finished < MIN_MONTH || before.finished < MIN_MONTH || !a || !b || now.cleanPct === null || before.cleanPct === null) {
    return { result: 'insuficiente', text: `Amostra insuficiente: são precisas ${MIN_MONTH} threads concluídas em cada um dos dois meses.` }
  }
  const spend = (a - b) / b
  const quality = now.cleanPct - before.cleanPct
  const cheaper = spend < -SPEND_TOLERANCE && quality >= -QUALITY_TOLERANCE
  const better = spend <= SPEND_TOLERANCE && quality > QUALITY_TOLERANCE
  const change = `tokens por thread resolvida ${spend >= 0 ? '+' : ''}${percent(a - b, b)}%, ` +
    `sem retrabalho ${quality >= 0 ? '+' : ''}${Math.round(quality * 10) / 10} p.p.`
  const caveat = partial ? ' O mês anterior é base parcial.' : ''
  return {
    result: cheaper || better ? 'ganho' : 'sem-ganho',
    text: `${cheaper || better ? 'Há ganho' : 'Sem ganho comprovado'}: ${change}.${caveat}`
  }
}
