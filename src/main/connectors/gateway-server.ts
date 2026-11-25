// Local socket the per-thread gateway scripts talk to. Each launch gets a random capability
// token bound to one thread; the handler only ever sees the thread the token was issued for.
import net from 'node:net'
import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ThreadRef } from '../../shared/connectors.ts'
import { BAD_SESSION, MAX_LINE, MAX_RESULT, type GwRequest, type GwResponse } from './gateway-protocol.ts'

export type GwHandler = (ctx: ThreadRef, req: GwRequest, signal: AbortSignal) => Promise<unknown>

export interface GatewayServer {
  path: string
  issue(t: ThreadRef): string
  close(): Promise<void>
}

export function socketPath(userData: string, pid: number): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\brandyterm-gw-${pid}`
  const p = join(userData, `gw-${pid}.sock`)
  return Buffer.byteLength(p) > 100 ? join(tmpdir(), `bt-gw-${pid}.sock`) : p
}

function cap(result: unknown): unknown {
  const text = JSON.stringify(result) ?? 'null'
  if (text.length <= MAX_RESULT) return result
  return `${text.slice(0, MAX_RESULT)}\n[resultado truncado: ${text.length} caracteres]`
}

function parse(line: string): GwRequest | null {
  try {
    const r = JSON.parse(line)
    return r && typeof r === 'object' && typeof r.id === 'number' ? (r as GwRequest) : null
  } catch { return null }
}

export async function startGatewayServer(path: string, handle: GwHandler): Promise<GatewayServer> {
  const tokens = new Map<string, ThreadRef>()
  const byThread = new Map<string, string>()
  const sockets = new Set<net.Socket>()

  const answer = async (req: GwRequest, signal: AbortSignal): Promise<GwResponse> => {
    const ctx = typeof req.token === 'string' ? tokens.get(req.token) : undefined
    if (!ctx) return { id: req.id, ok: false, error: BAD_SESSION }
    try {
      return { id: req.id, ok: true, result: cap(await handle({ ...ctx }, req, signal)) }
    } catch (e) {
      return { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  const server = net.createServer(sock => {
    sockets.add(sock)
    const ctl = new AbortController()
    let buf = ''
    sock.setEncoding('utf8')
    sock.on('error', () => {})
    sock.on('close', () => { sockets.delete(sock); ctl.abort() })
    sock.on('data', (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const req = parse(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
        if (!req) { sock.destroy(); return }
        void answer(req, ctl.signal).then(res => { if (!sock.destroyed) sock.write(JSON.stringify(res) + '\n') })
      }
      if (buf.length > MAX_LINE) sock.destroy()
    })
  })

  if (process.platform !== 'win32') fs.rmSync(path, { force: true })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => { server.off('error', reject); resolve() })
  })
  if (process.platform !== 'win32') fs.chmodSync(path, 0o600)

  return {
    path,
    issue(t) {
      const key = `${t.projectId}\0${t.threadId}`
      const known = byThread.get(key)
      if (known) return known
      const token = randomBytes(24).toString('hex')
      tokens.set(token, { projectId: t.projectId, threadId: t.threadId })
      byThread.set(key, token)
      return token
    },
    close() {
      for (const s of sockets) s.destroy()
      return new Promise<void>(resolve => server.close(() => {
        if (process.platform !== 'win32') fs.rmSync(path, { force: true })
        resolve()
      }))
    },
  }
}
