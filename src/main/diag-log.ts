// Diagnostic logs, one JSON-lines file per area. No Electron import: index.ts says where to write,
// and until then (plain Node tests included) every call is a no-op.
import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createRedactor } from './diag-redact.ts'

export type DiagArea = 'mcp' | 'plugins' | 'skills' | 'remote'
export type DiagLevel = 'debug' | 'info' | 'warn' | 'error'

export interface DiagConfig {
  dir: string
  debug: boolean
  maxBytes?: number
}

const MAX_BYTES = 1024 * 1024
const OLD_FILES = 2
const MAX_PENDING = 5000

let config: DiagConfig | null = null
let queue: Promise<void> = Promise.resolve()
let pending = 0
const sizes = new Map<string, number>()
const lastByKey = new Map<string, string>()

export function configureDiagLog(next: DiagConfig | null): void {
  config = next
  sizes.clear()
  lastByKey.clear()
}

export const diagLogDir = (): string | null => config?.dir ?? null

export const flushDiagLog = (): Promise<void> => queue

function serialize(area: DiagArea, level: DiagLevel, msg: string, data?: Record<string, unknown>): string {
  const redact = createRedactor()
  const ts = new Date().toISOString()
  const entry = { ts, area, level, msg: redact.text(msg), data: {} as unknown }
  try {
    entry.data = redact.value(data ?? {})
    return `${JSON.stringify(entry)}\n`
  } catch {
    return `${JSON.stringify({ ...entry, data: { unserializable: true } })}\n`
  }
}

async function rotate(dir: string, area: DiagArea): Promise<void> {
  const name = (n: number): string => join(dir, n ? `${area}.${n}.log` : `${area}.log`)
  await rm(name(OLD_FILES), { force: true }).catch(() => {})
  for (let n = OLD_FILES - 1; n >= 0; n--) await rename(name(n), name(n + 1)).catch(() => {})
}

async function write(target: DiagConfig, area: DiagArea, line: string): Promise<void> {
  const file = join(target.dir, `${area}.log`)
  const bytes = Buffer.byteLength(line)
  try {
    await mkdir(target.dir, { recursive: true })
    let size = sizes.get(file) ?? (await stat(file).then(s => s.size, () => 0))
    if (size > 0 && size + bytes > (target.maxBytes ?? MAX_BYTES)) {
      await rotate(target.dir, area)
      size = await stat(file).then(s => s.size, () => 0)
    }
    await appendFile(file, line, { encoding: 'utf8', mode: 0o600 })
    sizes.set(file, size + bytes)
  } catch {
    // A full or read-only disk loses log lines, never the app.
    sizes.delete(file)
  }
}

export function diagLog(area: DiagArea, level: DiagLevel, msg: string, data?: Record<string, unknown>): void {
  const target = config
  if (!target || (level === 'debug' && !target.debug) || pending >= MAX_PENDING) return
  try {
    const line = serialize(area, level, msg, data)
    pending++
    queue = queue.then(() => write(target, area, line)).finally(() => { pending-- })
  } catch {
    // Logging is never a reason for the caller to fail.
  }
}

// For things that are re-evaluated often (discovery, load summaries): logs only when the entry changes.
export function diagLogOnChange(
  key: string, area: DiagArea, level: DiagLevel, msg: string, data?: Record<string, unknown>
): void {
  if (!config) return
  let signature: string
  try {
    signature = JSON.stringify([level, msg, data])
  } catch {
    signature = msg
  }
  if (lastByKey.get(key) === signature) return
  lastByKey.set(key, signature)
  diagLog(area, level, msg, data)
}
