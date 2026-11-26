// Reads one diagnostic log area (diag-log.ts writes it) back for the "Ver logs" modal.
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { LogArea, LogEntry, LogLevel, LogsRead } from '../shared/logs.ts'

const AREAS: Record<LogArea, true> = { mcp: true, plugins: true, skills: true, remote: true, notify: true, usage: true, update: true }
const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']

export function logArea(value: unknown): LogArea {
  if (typeof value === 'string' && Object.hasOwn(AREAS, value)) return value as LogArea
  throw new Error(`Área de log desconhecida: ${String(value)}`)
}

function parse(line: string): LogEntry | null {
  try {
    const e = JSON.parse(line)
    if (!e || typeof e.ts !== 'string' || typeof e.msg !== 'string' || !LEVELS.includes(e.level)) return null
    return { ts: e.ts, level: e.level, msg: e.msg, data: e.data }
  } catch {
    return null
  }
}

// a file that does not exist (nothing logged yet, or rotating right now) is an empty one
const missing = <T>(fallback: T) => (error: NodeJS.ErrnoException): T => {
  if (error.code === 'ENOENT') return fallback
  throw error
}

export async function readLogs(dir: string, area: string): Promise<LogsRead> {
  const name = logArea(area)
  // taken before reading: a line written meanwhile makes the next summary ask again
  const current = await stat(join(dir, `${name}.log`)).catch(missing(null))
  const files = [`${name}.2.log`, `${name}.1.log`, `${name}.log`]
  const texts = await Promise.all(files.map((f) => readFile(join(dir, f), 'utf8').catch(missing(''))))
  const entries = texts.flatMap((t) => t.split('\n')).flatMap((l) => parse(l) ?? [])
  return { entries, size: current?.size ?? 0, mtimeMs: current?.mtimeMs ?? 0 }
}
