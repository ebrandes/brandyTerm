// Live MCP clients, one per connector: connected lazily on first use, shared, closed after idle.
import { EventEmitter } from 'node:events'
import type { Connector, ConnectorStatus } from '../../shared/connectors.ts'

export interface ToolInfo { name: string; description?: string; inputSchema: unknown }
export interface CallResult { content: unknown[]; isError?: boolean }
export interface LiveClient {
  tools(): Promise<ToolInfo[]>
  call(tool: string, args: unknown, signal?: AbortSignal): Promise<CallResult>
  close(): Promise<void>
  onClose(cb: (stderrTail: string) => void): void
}
export interface AuthMaterial {
  env: Record<string, string>
  headers: Record<string, string>
  oauth?: import('@modelcontextprotocol/sdk/client/auth.js').OAuthClientProvider
}
export type ClientFactory = (c: Connector, auth: AuthMaterial) => Promise<LiveClient>

export class ConnectorError extends Error {
  readonly kind: 'login' | 'failed'
  constructor(message: string, kind: 'login' | 'failed') {
    super(message)
    this.name = 'ConnectorError'
    this.kind = kind
  }
}

export const IDLE_MS = 600_000
const TAIL_MAX = 500

interface Entry {
  status: ConnectorStatus
  error?: string
  toolCount?: number
  client?: LiveClient
  pending?: Promise<LiveClient>
  busy: number
  timer?: NodeJS.Timeout
}

export class ConnectorHub extends EventEmitter {
  private readonly factory: ClientFactory
  private readonly authFor: (c: Connector) => AuthMaterial
  private readonly idleMs: number
  private readonly entries = new Map<string, Entry>()

  constructor(deps: { factory: ClientFactory; auth: (c: Connector) => AuthMaterial; idleMs?: number }) {
    super()
    this.factory = deps.factory
    this.authFor = deps.auth
    this.idleMs = deps.idleMs ?? IDLE_MS
  }

  private entry(id: string): Entry {
    let e = this.entries.get(id)
    if (!e) this.entries.set(id, (e = { status: 'desconectado', busy: 0 }))
    return e
  }

  private set(id: string, status: ConnectorStatus, error?: string): void {
    const e = this.entry(id)
    e.status = status
    e.error = error
    this.emit('change', id)
  }

  status(id: string): { status: ConnectorStatus; error?: string; toolCount?: number } {
    const e = this.entries.get(id)
    if (!e) return { status: 'desconectado' }
    return { status: e.status, ...(e.error ? { error: e.error } : {}), ...(e.toolCount !== undefined ? { toolCount: e.toolCount } : {}) }
  }

  markLogin(id: string): void {
    this.set(id, 'precisa de login')
  }

  private connect(c: Connector): Promise<LiveClient> {
    const e = this.entry(c.id)
    if (e.client) return Promise.resolve(e.client)
    if (e.pending) return e.pending
    const p = (async () => {
      try {
        const client = await this.factory(c, this.authFor(c))
        client.onClose(tail => this.crashed(c.id, client, tail))
        e.client = client
        this.set(c.id, 'conectado')
        return client
      } catch (err) {
        const ce = err instanceof ConnectorError ? err : new ConnectorError(err instanceof Error ? err.message : String(err), 'failed')
        if (ce.kind === 'login') this.set(c.id, 'precisa de login')
        else this.set(c.id, 'erro', ce.message.slice(-TAIL_MAX))
        throw ce
      } finally {
        e.pending = undefined
      }
    })()
    e.pending = p
    return p
  }

  private crashed(id: string, client: LiveClient, tail: string): void {
    const e = this.entry(id)
    if (e.client !== client) return // closed by us
    e.client = undefined
    if (e.timer) clearTimeout(e.timer)
    const t = tail.trim().slice(-TAIL_MAX)
    this.set(id, 'erro', t || 'A conexão com o conector foi encerrada.')
  }

  private arm(id: string): void {
    const e = this.entry(id)
    if (e.timer) clearTimeout(e.timer)
    if (e.busy > 0 || !e.client) return
    e.timer = setTimeout(() => { void this.close(id) }, this.idleMs)
    e.timer.unref?.()
  }

  private async use<T>(c: Connector, fn: (cl: LiveClient) => Promise<T>): Promise<T> {
    const e = this.entry(c.id)
    e.busy++
    if (e.timer) clearTimeout(e.timer)
    try {
      return await fn(await this.connect(c))
    } catch (err) {
      if (err instanceof ConnectorError && err.kind === 'login') this.markLogin(c.id)
      throw err
    } finally {
      e.busy--
      this.arm(c.id)
    }
  }

  async tools(c: Connector): Promise<ToolInfo[]> {
    return this.use(c, async cl => {
      const list = await cl.tools()
      const e = this.entry(c.id)
      if (e.toolCount !== list.length) { e.toolCount = list.length; this.emit('change', c.id) }
      return list
    })
  }

  call(c: Connector, tool: string, args: unknown, signal?: AbortSignal): Promise<CallResult> {
    return this.use(c, cl => cl.call(tool, args, signal))
  }

  async test(c: Connector): Promise<number> {
    return (await this.tools(c)).length
  }

  async close(id: string): Promise<void> {
    const e = this.entries.get(id)
    if (!e) return
    if (e.timer) clearTimeout(e.timer)
    const client = e.client ?? (e.pending ? await e.pending.catch(() => undefined) : undefined)
    if (!client) return
    e.client = undefined
    try { await client.close() } catch { /* already gone */ }
    if (e.status === 'conectado') this.set(id, 'desconectado')
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map(id => this.close(id)))
  }
}
