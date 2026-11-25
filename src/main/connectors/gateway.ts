// Per-thread stdio MCP server. Runs as plain Node (ELECTRON_RUN_AS_NODE): imports nothing from
// electron. Every tool call is proxied over one local socket to the main process.
import net from 'node:net'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { MAX_RESULT, NOT_RESPONDING, TOOLS, type GwRequest, type GwResponse } from './gateway-protocol.ts'

type Pending = { resolve(r: GwResponse): void; reject(e: Error): void }

class Link {
  private sock: net.Socket | null = null
  private pending = new Map<number, Pending>()
  private next = 1
  private path: string
  private token: string
  constructor(path: string, token: string) { this.path = path; this.token = token }

  private connect(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const s = net.connect(this.path)
      let buf = ''
      s.setEncoding('utf8')
      s.once('connect', () => { s.off('error', reject); s.on('error', () => {}); resolve(s) })
      s.once('error', reject)
      s.on('data', (chunk: string) => {
        buf += chunk
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          try {
            const res = JSON.parse(line) as GwResponse
            const p = this.pending.get(res.id)
            if (p) { this.pending.delete(res.id); p.resolve(res) }
          } catch { /* ignore a garbled line */ }
        }
      })
      s.on('close', () => {
        if (this.sock === s) this.sock = null
        for (const [id, p] of this.pending) { this.pending.delete(id); p.reject(new Error(NOT_RESPONDING)) }
      })
    })
  }

  async request(part: Omit<GwRequest, 'id' | 'token'>): Promise<GwResponse> {
    if (!this.sock || this.sock.destroyed) {
      try { this.sock = await this.connect() } catch { throw new Error(NOT_RESPONDING) }
    }
    const id = this.next++
    const sock = this.sock
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      sock.write(JSON.stringify({ ...part, id, token: this.token }) + '\n', e => {
        if (e && this.pending.delete(id)) reject(new Error(NOT_RESPONDING))
      })
    })
  }
}

function clip(text: string): string {
  return text.length <= MAX_RESULT ? text : text.slice(0, MAX_RESULT) + '\n[resultado truncado]'
}

function reply(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text: clip(text) }], ...(isError ? { isError: true } : {}) }
}

function toRequest(tool: string, a: Record<string, unknown>): Omit<GwRequest, 'id' | 'token'> | null {
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  if (tool === 'list_connectors') return { op: 'list' }
  if (tool === 'connector_tools') return { op: 'tools', name: str(a.name) }
  if (tool === 'call_connector') return { op: 'call', name: str(a.name), tool: str(a.tool), args: a.args }
  return null
}

async function main(): Promise<void> {
  const link = new Link(process.env.BRANDY_GATEWAY_SOCKET ?? '', process.env.BRANDY_GATEWAY_TOKEN ?? '')
  const server = new Server({ name: 'brandy-gateway', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const req = toRequest(params.name, (params.arguments ?? {}) as Record<string, unknown>)
    if (!req) return reply(`Ferramenta desconhecida: ${params.name}`, true)
    try {
      const res = await link.request(req)
      if (!res.ok) return reply(res.error, true)
      return reply(typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2))
    } catch (e) {
      return reply(e instanceof Error ? e.message : String(e), true)
    }
  })
  process.stdin.on('close', () => process.exit(0))
  await server.connect(new StdioServerTransport())
}

void main()
