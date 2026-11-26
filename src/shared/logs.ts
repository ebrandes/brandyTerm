/** The "Ver logs" modal: what main reads from a diagnostic log and what the Haiku summary answers. */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** the log areas the app can show; the connectors panel opens 'mcp' */
export type LogArea = 'mcp' | 'plugins' | 'skills' | 'remote' | 'notify' | 'usage' | 'update'

export interface LogEntry {
  ts: string
  level: LogLevel
  msg: string
  data?: unknown
}

export interface LogsRead {
  /** oldest first, rotated files included */
  entries: LogEntry[]
  /** of the current file: together they say whether the log changed */
  size: number
  mtimeMs: number
}

export interface LogSummary {
  state: 'ok' | 'empty' | 'error' | 'cancelled'
  text?: string
  error?: string
  cached?: boolean
  /** what the model call that produced the text cost */
  costUsd?: number
}

export interface LogFilter {
  query: string
  /** none chosen means every level */
  levels: LogLevel[]
}

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function filterEntries(entries: LogEntry[], { query, levels }: LogFilter): LogEntry[] {
  const needle = fold(query.trim())
  return entries.filter((e) => {
    if (levels.length > 0 && !levels.includes(e.level)) return false
    if (!needle) return true
    return fold(`${e.msg} ${e.data === undefined ? '' : JSON.stringify(e.data)}`).includes(needle)
  })
}
