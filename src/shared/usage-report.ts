import type { AgentId } from './types.ts'

/** What a run was for. */
export type RunKind = 'coordinator' | 'plan' | 'work' | 'report' | 'router' | 'memory' | 'compact' | 'scan' | 'other'

/** Who a run belongs to, for the usage ledger only (it changes nothing in the run itself). */
export interface RunTag {
  kind: RunKind
  projectId?: string
  threadId?: string
  /** 'leve' | 'padrao' | 'pesado' | 'pesado+' */
  tier?: string
}

/** One agent run, as written to the monthly ledger. */
export interface LedgerEntry extends RunTag {
  ts: string
  /** the folder it ran in; names the project of runs without a projectId */
  cwd: string
  agent: AgentId
  model?: string
  effort?: string
  /** input outside the cache */
  input: number
  output: number
  cached: number
  costUsd?: number
  ok: boolean
  /** RTK compressed the shell output of this run */
  rtk: boolean
  /** TokenEconomizer was loaded in this run */
  te: boolean
}

/** Tokens of one project × agent × model in a month. */
export interface UsageRow {
  project: string
  agent: AgentId
  model: string
  runs: number
  input: number
  output: number
  cached: number
  /** 0 when the CLI reports no cost (Codex) */
  costUsd: number
  rtkRuns: number
  teRuns: number
}

export interface KindRow {
  kind: RunKind
  runs: number
  input: number
  output: number
  costUsd: number
}

/** RTK's own estimate for one project folder (its history has no agent). */
export interface RtkRow {
  project: string
  commands: number
  /** shell output before compression, in tokens */
  input: number
  saved: number
  /** days far above the month's usual savings */
  peaks: { date: string; saved: number }[]
  savedWithoutPeaks: number
}

export interface QualityRow {
  tier: string
  open: number
  finished: number
  resolved: number
  clean: number
  cleanPct: number | null
  replaced: number
  corrections: number
  escalations: number
  tokensPerResolved: number | null
}

export type SaverId = 'rtk' | 'te'

/** Threads of the same agent and tier, with and without a saver in all their work runs. */
export interface CompareRow {
  tool: SaverId
  agent: AgentId
  tier: string
  with: QualityRow
  without: QualityRow
  /** both sides have enough finished threads to be read */
  enough: boolean
}

export interface Verdict {
  result: 'ganho' | 'sem-ganho' | 'insuficiente'
  text: string
}

export interface MonthReport {
  month: string
  /** months with data, newest first */
  months: string[]
  /** first run recorded in the month; undefined when nothing was recorded */
  ledgerSince?: string
  usage: UsageRow[]
  kinds: KindRow[]
  /** null when RTK is not installed */
  rtk: RtkRow[] | null
  compare: CompareRow[]
  quality: { total: QualityRow; tiers: QualityRow[] }
  previous: { month: string; partial: boolean; total: QualityRow }
  verdict: Verdict
}
