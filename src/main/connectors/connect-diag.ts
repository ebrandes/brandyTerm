// Says why a connector did not start (which stage, what happened, the stderr tail with secrets removed) and
// writes the MCP diagnostic events. The panel shows the message: it must fit the card's 500 characters.
import { basename } from 'node:path'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { Connector } from '../../shared/connectors.ts'
import { createRedactor } from '../diag-redact.ts'
import { diagLog, type DiagLevel } from '../diag-log.ts'
import type { AuthMaterial } from './hub.ts'

export type Stage = 'spawn' | 'connect' | 'initialize' | 'tools/list'

const STAGE_TEXT: Record<Stage, string> = {
  spawn: 'iniciar o processo',
  connect: 'conectar à URL',
  initialize: 'initialize (handshake MCP)',
  'tools/list': 'tools/list (listar ferramentas)',
}
const STDERR_MAX = 220
const MESSAGE_MAX = 500

export interface FailureContext {
  connector: Connector
  stage: Stage
  timeoutMs: number
  /** stderr already redacted */
  stderr: string
  /** the process or the connection ended before the answer */
  ended: boolean
}

/** the stage an error from client.connect belongs to: a spawn error carries an errno code, a fetch failure a TypeError */
export function connectStage(c: Connector, e: unknown): Stage {
  const code = (e as { code?: unknown } | null)?.code
  if (c.transport === 'stdio') return typeof code === 'string' && /^E[A-Z]+$/.test(code) ? 'spawn' : 'initialize'
  return e instanceof TypeError ? 'connect' : 'initialize'
}

const isTimeout = (e: unknown): boolean => e instanceof McpError && e.code === ErrorCode.RequestTimeout
const target = (c: Connector): string => (c.transport === 'stdio' ? `comando "${basename(c.command ?? '')}"` : 'URL')

function why(e: unknown, f: FailureContext): string {
  const wait = f.timeoutMs >= 1000 ? `${Math.round(f.timeoutMs / 1000)} s` : `${f.timeoutMs} ms`
  if (isTimeout(e)) {
    const hint = f.connector.transport === 'stdio'
      ? `O ${target(f.connector)} rodou mas não respondeu ao protocolo MCP pelo stdio: confira se ele é o servidor (não um instalador como "claude mcp add") e se os argumentos estão certos.`
      : 'Confira a URL e se o servidor está no ar.'
    return `sem resposta em ${wait} (MCP ${ErrorCode.RequestTimeout}). ${hint}`
  }
  const code = (e as { code?: unknown } | null)?.code
  if (f.stage === 'spawn' && code === 'ENOENT') return `${target(f.connector)} não encontrado (ENOENT). Confira o caminho ou instale o programa.`
  if (f.stage === 'connect') {
    const net = (e as { cause?: { code?: unknown } } | null)?.cause?.code
    return `sem conexão com o servidor${typeof net === 'string' ? ` (${net})` : ''}. Confira a rede e a URL.`
  }
  if (f.ended) return `o ${f.connector.transport === 'stdio' ? 'processo terminou' : 'servidor fechou a conexão'} antes de responder.`
  return e instanceof Error ? e.message : String(e)
}

/** The message for the card and the agent: "Falhou em <stage>: <why>" and the stderr tail. */
export function failureMessage(e: unknown, f: FailureContext, redact: (s: string) => string): string {
  const head = redact(`Falhou em ${STAGE_TEXT[f.stage]}: ${why(e, f)}`)
  const tail = f.stderr.trim().slice(-STDERR_MAX)
  const out = tail ? `${head}\nstderr: ${tail}` : head
  return out.length > MESSAGE_MAX ? `${out.slice(0, MESSAGE_MAX - 1)}…` : out
}

/** Keeps the recent stderr with the connector's own secrets (and the app's) hidden. */
export function stderrRecorder(c: Connector, auth: AuthMaterial, max = 500) {
  const redactor = createRedactor([...Object.values(auth.env), ...Object.values(auth.headers)])
  let raw = ''
  return {
    redact: (s: string): string => redactor.text(s),
    push(chunk: string): void {
      raw = (raw + chunk).slice(-max * 4)
      mcpLog('debug', 'stderr', c, { text: redactor.text(chunk.slice(-2000)) })
    },
    /** redacted before cutting, so no half secret survives the cut */
    tail: (): string => redactor.text(raw).slice(-max),
  }
}

/** an MCP event: the connector's name, transport and program name only, never its env, headers or full URL */
export function mcpLog(level: DiagLevel, msg: string, c: Connector, data: Record<string, unknown> = {}): void {
  let where: string | undefined
  if (c.transport === 'stdio') where = basename(c.command ?? '')
  else {
    try { where = new URL(c.url ?? '').host } catch { where = undefined }
  }
  diagLog('mcp', level, msg, { connector: c.name, id: c.id, transport: c.transport, ...(where ? { target: where } : {}), ...data })
}
