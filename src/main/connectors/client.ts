// The real ClientFactory: SDK Client over stdio or streamable HTTP.
import os from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Connector } from '../../shared/connectors.ts'
import { ConnectorError, LOGIN_NEEDED, type AuthMaterial, type CallResult, type ClientFactory, type LiveClient, type ToolInfo } from './hub.ts'
import { loginPath } from './shell-path.ts'
import { killPidTree } from '../adapters/proc.ts'
import { fixPastedCommand, installHint } from '../../shared/install-command.ts'
import { connectStage, failureMessage, mcpLog, stderrRecorder, type Stage } from './connect-diag.ts'

const TAIL_MAX = 500
/** initialize: the SDK's default request timeout, made explicit so the message can say it */
export const CONNECT_TIMEOUT_MS = 60_000
/** a connector tool may run long (a deploy, a performance trace): 10 min, extended while it reports progress */
export const CALL_TIMEOUT_MS = 600_000
export const LIST_TIMEOUT_MS = 60_000

function httpTransport(c: Connector, auth: AuthMaterial): StreamableHTTPClientTransport {
  if (!c.url) throw new ConnectorError('Conector sem URL.', 'failed')
  return new StreamableHTTPClientTransport(new URL(c.url), {
    requestInit: { headers: auth.headers },
    ...(auth.oauth ? { authProvider: auth.oauth } : {}),
  })
}

async function stdioTransport(c: Connector, auth: AuthMaterial): Promise<StdioClientTransport> {
  if (!c.command) throw new ConnectorError('Conector sem comando.', 'failed')
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  Object.assign(env, auth.env)
  if (process.platform !== 'win32') env.PATH = await loginPath()
  return new StdioClientTransport({ command: c.command, args: c.args ?? [], env, stderr: 'pipe', cwd: os.homedir() })
}

/** The hub's error for what the connector did: refused credentials (HTTP 401 or 403, the SDK's UnauthorizedError) mean a login. */
export function connectorError(e: unknown): ConnectorError {
  if (e instanceof ConnectorError) return e
  if (e instanceof UnauthorizedError) return new ConnectorError(LOGIN_NEEDED, 'login')
  if (e instanceof StreamableHTTPError && (e.code === 401 || e.code === 403)) return new ConnectorError(LOGIN_NEEDED, 'login')
  return new ConnectorError(e instanceof Error ? e.message : String(e), 'failed')
}

const refused = (e: unknown): boolean => connectorError(e).kind === 'login'

export interface FactoryOpts {
  /** how long initialize may take; the SDK's own default */
  connectMs?: number
}

/** a connector saved with another tool's install command never answers: say so before running it */
function refusePasted(c: Connector): void {
  if (c.transport !== 'stdio' || !c.command) return
  const fix = fixPastedCommand(c.command, c.args ?? [])
  if (fix?.kind !== 'install') return
  mcpLog('error', 'comando de instalação salvo como servidor', c, { tool: fix.tool })
  throw new ConnectorError(installHint(fix), 'failed')
}

export function createFactory(opts: FactoryOpts = {}): ClientFactory {
  const connectMs = opts.connectMs ?? CONNECT_TIMEOUT_MS
  return async (c, auth) => {
    refusePasted(c)
    const started = Date.now()
    const ms = (): number => Date.now() - started
    const transport: Transport & { stderr?: unknown } = c.transport === 'stdio' ? await stdioTransport(c, auth) : httpTransport(c, auth)
    const client = new Client({ name: 'brandyterm', version: '1.0.0' }, { capabilities: {} })
    const err = stderrRecorder(c, auth, TAIL_MAX)
    const stderr = (transport as StdioClientTransport).stderr
    stderr?.on('data', (d: Buffer) => err.push(d.toString()))
    mcpLog('info', c.transport === 'stdio' ? 'iniciando processo' : 'conectando', c)

    const closers: Array<(tail: string) => void> = []
    let closed = false
    let ended = false
    let rejectAll: (e: Error) => void = () => {}
    const dead = new Promise<never>((_, rej) => { rejectAll = rej })
    dead.catch(() => {})
    let crash: Promise<Error> | undefined
    client.onclose = () => {
      ended = true
      if (closed) return
      closed = true
      // Let the last stderr chunk land before reporting.
      crash = new Promise<Error>(res => setTimeout(() => {
        const tail = err.tail()
        mcpLog('warn', 'conexão encerrada pelo conector', c, { ms: ms(), stderr: tail })
        const e = new Error(tail.trim() || 'A conexão com o conector foi encerrada.')
        rejectAll(e)
        for (const f of closers) f(tail)
        res(e)
      }, 20))
    }
    // The SDK rejects in-flight calls with a bare "Connection closed"; the stderr tail says why.
    const explain = async (e: unknown): Promise<unknown> => (crash ? crash : e)
    const fail = async (stage: Stage, e: unknown, timeoutMs: number): Promise<ConnectorError> => {
      const ce = connectorError(e)
      if (ce.kind === 'login') return ce
      await new Promise(r => setTimeout(r, 20)) // the last stderr chunk
      const f = { connector: c, stage, timeoutMs, stderr: err.tail(), ended }
      mcpLog('error', `falhou em ${stage}`, c, { ms: ms(), code: (e as { code?: unknown } | null)?.code, error: ce.message, stderr: f.stderr })
      return new ConnectorError(failureMessage(e, f, err.redact), 'failed')
    }

    try {
      await client.connect(transport, { timeout: connectMs })
    } catch (e) {
      const ce = await fail(connectStage(c, e), e, connectMs)
      closed = true
      await client.close().catch(() => {})
      throw ce
    }
    const v = client.getServerVersion()
    mcpLog('info', 'initialize ok', c, { ms: ms(), server: v?.name, version: v?.version, protocol: (transport as { protocolVersion?: string }).protocolVersion })

    const live: LiveClient = {
      async tools(signal): Promise<ToolInfo[]> {
        const t0 = Date.now()
        const r = await Promise.race([client.listTools(undefined, { timeout: LIST_TIMEOUT_MS, ...(signal ? { signal } : {}) }), dead]).catch(async e => {
          if (refused(e)) throw connectorError(e)
          throw crash ? await crash : await fail('tools/list', e, LIST_TIMEOUT_MS)
        })
        mcpLog('info', 'tools/list ok', c, { ms: Date.now() - t0, count: r.tools.length })
        return r.tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
      },
      async call(tool, args, signal): Promise<CallResult> {
        try {
          const r = await Promise.race([
            client.callTool({ name: tool, arguments: (args ?? {}) as Record<string, unknown> }, undefined, {
              signal,
              timeout: CALL_TIMEOUT_MS,
              resetTimeoutOnProgress: true,
              // the SDK asks the server for progress only when there is a handler; without it nothing resets the timeout
              onprogress: () => {},
            }),
            dead,
          ])
          return { content: (r.content as unknown[]) ?? [], ...(r.isError ? { isError: true } : {}) }
        } catch (e) {
          throw refused(e) ? connectorError(e) : await explain(e)
        }
      },
      async close() {
        closed = true
        await client.close()
      },
      onClose(cb) { closers.push(cb) },
      kill() {
        closed = true
        const pid = (transport as StdioClientTransport).pid
        // on Windows the npx child under cmd.exe goes too
        if (pid) killPidTree(pid)
      },
    }
    return live
  }
}

export const realFactory: ClientFactory = createFactory()

/** Completes an OAuth login: exchanges the code for tokens through the connector's provider. */
export async function finishAuth(c: Connector, auth: AuthMaterial, code: string): Promise<void> {
  try {
    await httpTransport(c, auth).finishAuth(code)
  } catch (e) {
    throw connectorError(e)
  }
}
