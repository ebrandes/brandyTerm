/**
 * Which Claude account pays for a run. The adapter asks `pick()` at spawn time, reports
 * every rate_limit_event back, and `failover()` lets a run that hit the limit continue
 * on another account. Main wires the real provider (accounts.ts); scripts keep the default.
 */

export interface RateWindow {
  utilization: number
  resetsAt?: number
  status?: string
}

export interface RateInfo {
  status?: string
  resetsAt?: number
  rateLimitType?: string
  unifiedWindows?: Record<string, RateWindow>
}

export interface ClaudeAuth {
  pick(): { id: string; label: string; env: Record<string, string | undefined> }
  report(accountId: string, info: RateInfo): void
  /** the run on `accountId` hit the limit; returns the account that takes over, if any */
  failover(accountId: string): { label: string } | null
}

let current: ClaudeAuth = {
  pick: () => ({ id: 'login', label: 'login', env: {} }),
  report: () => {},
  failover: () => null
}

export function setClaudeAuth(a: ClaudeAuth): void {
  current = a
}

export function claudeAuth(): ClaudeAuth {
  return current
}

/** errors Claude Code prints when the subscription limit is reached */
export const LIMIT_RE = /usage limit|hit your (session |weekly |opus )?limit|rate.?limit|\b429\b|limite de uso/i
