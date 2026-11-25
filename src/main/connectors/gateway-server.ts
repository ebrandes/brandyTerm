// Local socket the per-thread gateway scripts talk to. Each launch gets a random capability
// token bound to one thread; the handler only ever sees the thread the token was issued for.
import net from 'node:net'
import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ThreadRef } from '../../shared/connectors.ts'
import { BAD_SESSION, LineReader, MAX_REPLY, type GwRequest, type GwResponse } from './gateway-protocol.ts'

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

/** The reply text, encoded once: a string goes as is, anything else as compact JSON. Only a backstop cut happens here. */
function cap(result: unknown): string {
  const text = typeof result === 'string' ? result : (JSON.stringify(result) ?? 'null')
  return text.length <= MAX_REPLY ? text : `${text.slice(0, MAX_REPLY)}\n[resultado truncado: ${text.length} caracteres]`
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
    /** this socket's requests still running, by id: a close or a cancel aborts them */
    const inflight = new Map<number, AbortController>()
    const lines = new LineReader()
    sock.on('error', () => {})
    sock.on('close', () => {
      sockets.delete(sock)
      for (const c of inflight.values()) c.abort()
      inflight.clear()
    })
    sock.on('data', (chunk: Buffer) => {
      let bad = false
      const ok = lines.feed(chunk, line => {
        if (bad) return
        const req = parse(line)
        if (!req) { bad = true; return }
        if (req.op === 'cancel') {
          if (typeof req.token === 'string' && tokens.has(req.token)) inflight.get(req.id)?.abort()
          return
        }
        const ctl = new AbortController()
        inflight.set(req.id, ctl)
        void answer(req, ctl.signal).then(res => {
          if (inflight.get(req.id) === ctl) inflight.delete(req.id)
          // a cancelled request gets no answer: the gateway already told the agent
          if (!sock.destroyed && !ctl.signal.aborted) sock.write(JSON.stringify(res) + '\n')
        })
      })
      if (!ok || bad) sock.destroy()
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
      // everything that matters at quit happens before the first await
      for (const s of sockets) s.destroy()
      const closing = new Promise<void>(resolve => server.close(() => resolve()))
      if (process.platform !== 'win32') fs.rmSync(path, { force: true })
      return closing
    },
  }
}
