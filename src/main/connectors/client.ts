// The real ClientFactory: SDK Client over stdio or streamable HTTP.
import os from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Connector } from '../../shared/connectors.ts'
import { ConnectorError, type AuthMaterial, type CallResult, type ClientFactory, type LiveClient, type ToolInfo } from './hub.ts'
import { loginPath } from './shell-path.ts'

const TAIL_MAX = 500
const LOGIN_MSG = 'Precisa de login.'

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

function mapError(e: unknown): ConnectorError {
  if (e instanceof ConnectorError) return e
  if (e instanceof UnauthorizedError) return new ConnectorError(LOGIN_MSG, 'login')
  return new ConnectorError(e instanceof Error ? e.message : String(e), 'failed')
}

export const realFactory: ClientFactory = async (c, auth) => {
  const transport: Transport & { stderr?: unknown } = c.transport === 'stdio' ? await stdioTransport(c, auth) : httpTransport(c, auth)
  const client = new Client({ name: 'brandyterm', version: '1.0.0' }, { capabilities: {} })
  let tail = ''
  const stderr = (transport as StdioClientTransport).stderr
  stderr?.on('data', (d: Buffer) => { tail = (tail + d.toString()).slice(-TAIL_MAX) })

  const closers: Array<(tail: string) => void> = []
  let closed = false
  let rejectAll: (e: Error) => void = () => {}
  const dead = new Promise<never>((_, rej) => { rejectAll = rej })
  dead.catch(() => {})
  let crash: Promise<Error> | undefined
  client.onclose = () => {
    if (closed) return
    closed = true
    // Let the last stderr chunk land before reporting.
    crash = new Promise<Error>(res => setTimeout(() => {
      const err = new Error(tail.trim() || 'A conexão com o conector foi encerrada.')
      rejectAll(err)
      for (const f of closers) f(tail)
      res(err)
    }, 20))
  }
  // The SDK rejects in-flight calls with a bare "Connection closed"; the stderr tail says why.
  const explain = async (e: unknown): Promise<unknown> => (crash ? crash : e)

  try {
    await client.connect(transport)
  } catch (e) {
    await client.close().catch(() => {})
    const ce = mapError(e)
    if (ce.kind === 'failed' && tail.trim()) throw new ConnectorError(`${ce.message}\n${tail.trim()}`, 'failed')
    throw ce
  }

  const live: LiveClient = {
    async tools(): Promise<ToolInfo[]> {
      const r = await Promise.race([client.listTools(), dead]).catch(async e => { throw await explain(e) })
      return r.tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
    },
    async call(tool, args, signal): Promise<CallResult> {
      try {
        const r = await Promise.race([
          client.callTool({ name: tool, arguments: (args ?? {}) as Record<string, unknown> }, undefined, { signal }),
          dead,
        ])
        return { content: (r.content as unknown[]) ?? [], ...(r.isError ? { isError: true } : {}) }
      } catch (e) {
        throw e instanceof UnauthorizedError ? mapError(e) : await explain(e)
      }
    },
    async close() {
      closed = true
      await client.close()
    },
    onClose(cb) { closers.push(cb) },
  }
  return live
}

/** Completes an OAuth login: exchanges the code for tokens through the connector's provider. */
export async function finishAuth(c: Connector, auth: AuthMaterial, code: string): Promise<void> {
  try {
    await httpTransport(c, auth).finishAuth(code)
  } catch (e) {
    throw mapError(e)
  }
}
