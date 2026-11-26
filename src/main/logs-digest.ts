// What the Haiku summary gets to read: a bounded, deduplicated, redacted version of a log.
import { createRedactor } from './diag-redact.ts'
import type { LogEntry, LogLevel } from '../shared/logs.ts'

/** hard ceiling, in characters, of the log text sent to the model (about 6k tokens) */
export const MAX_SUMMARY_CHARS = 18_000
/** one entry may not take more than this, so a single stack trace does not push the others out */
const MAX_LINE_CHARS = 600

/** data fields that change on every repetition of the same event */
const VOLATILE = new Set(['ms', 'elapsedMs', 'durationMs', 'pid'])
const PRIORITY: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 2 }
const LABEL: Record<LogLevel, string> = { error: 'ERRO', warn: 'AVISO', info: 'info', debug: 'debug' }

interface Group {
  /** the newest occurrence */
  entry: LogEntry
  first: string
  count: number
}

const stable = (data: unknown): string =>
  JSON.stringify(data, (key, value) => (VOLATILE.has(key) ? undefined : value)) ?? ''

function group(entries: LogEntry[]): Group[] {
  const groups = new Map<string, Group>()
  for (const entry of entries) {
    const key = `${entry.level}\n${entry.msg}\n${stable(entry.data)}`
    const seen = groups.get(key)
    if (!seen) groups.set(key, { entry, first: entry.ts, count: 1 })
    else {
      seen.count++
      if (entry.ts >= seen.entry.ts) seen.entry = entry
      if (entry.ts < seen.first) seen.first = entry.ts
    }
  }
  return [...groups.values()]
}

/** local "DD/MM HH:MM:SS", so the model can say when something failed in the user's own time */
export function logTime(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${two(d.getDate())}/${two(d.getMonth() + 1)} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

function render({ entry, first, count }: Group): string {
  const redact = createRedactor()
  const data = entry.data === undefined ? '' : (JSON.stringify(redact.value(entry.data)) ?? '')
  const repeated = count > 1 ? ` (×${count}, desde ${logTime(first)})` : ''
  // redacted first, cut afterwards: cutting first could leave half a secret that no pattern recognizes
  const body = redact.text(`${entry.msg} ${data === '{}' ? '' : data}`).replace(/\s+/g, ' ').trim()
  const line = `${LABEL[entry.level]} ${logTime(entry.ts)}${repeated} ${body}`
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS - 1)}…` : line
}

/** errors first, then warnings, then the rest; newest first within each. Only whole lines, never above `max`. */
export function buildDigest(entries: LogEntry[], max: number = MAX_SUMMARY_CHARS): string {
  const ordered = group(entries).sort((a, b) =>
    PRIORITY[a.entry.level] - PRIORITY[b.entry.level] || b.entry.ts.localeCompare(a.entry.ts))
  const lines: string[] = []
  let length = 0
  for (const g of ordered) {
    const line = render(g)
    const next = length + line.length + (lines.length > 0 ? 1 : 0)
    if (next > max) break
    lines.push(line)
    length = next
  }
  return lines.join('\n')
}
