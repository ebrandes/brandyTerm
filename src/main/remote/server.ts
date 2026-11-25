// LAN host: pairing and encrypted channels for trusted devices. No Electron here (see index.ts for wiring).
import { EventEmitter } from 'node:events'
import http from 'node:http'
import os from 'node:os'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { toB64 } from '../../shared/remote/crypto.ts'
import type { MachineInfo } from '../../shared/remote/machine.ts'
import { PairingWindow } from '../../shared/remote/pairing.ts'
import { acceptChannel, type SecureChannel } from '../../shared/remote/channel.ts'
import type { Socket } from '../../shared/remote/protocol.ts'
import type { AppState } from '../../shared/types.ts'
import type { CallCtx } from '../rpc/registry.ts'
import { authorize, filterState } from './host-filter.ts'
import { handlePair, type PairingCtx } from './host-pairing.ts'
import { acceptLan } from './lan.ts'
import type { TrustStore } from './trust.ts'
import { wsSocket } from './ws-socket.ts'

export interface HostDeps {
  state(): AppState
  invoke(channel: string, arg: unknown, ctx: CallCtx): Promise<unknown>
  onChange(cb: () => void): () => void
  trust: TrustStore
  machine(): MachineInfo
  /** mDNS announcement; only when given */
  publish?: (info: { name: string; port: number; txt: Record<string, string> }) => { stop(): void }
  /** upgrade filter; default: local address is a LAN interface and the peer is a private IPv4 */
  acceptAddress?: (local: string, remote: string) => boolean
}

const MAX_PAYLOAD = 36 * 1024 * 1024
const IDLE_MS = 10_000
const PUSH_DEBOUNCE_MS = 100
const MAX_UNAUTH = 32
const REMOVED = 'dispositivo removido'

const defaultAccept = (local: string, remote: string): boolean => acceptLan(os.networkInterfaces(), local, remote)

interface Live { ch: SecureChannel; since: string }

export class HostServer extends EventEmitter {
  private readonly deps: HostDeps
  private readonly window = new PairingWindow(() => performance.now())
  private code: string | null = null
  private http: http.Server | null = null
  private wss: WebSocketServer | null = null
  private mdns: { stop(): void } | null = null
  private readonly live = new Set<Live>()
  private readonly unauth = new Set<WebSocket>()
  private readonly offs: (() => void)[] = []
  private pushTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = true

  constructor(deps: HostDeps) {
    super()
    this.deps = deps
  }

  async start(port: number): Promise<void> {
    if (this.http) throw new Error('já iniciado')
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD })
    const srv = http.createServer((_req, res) => { res.writeHead(404).end() })
    srv.on('upgrade', (req, sock, head) => this.upgrade(wss, req, sock, head))
    wss.on('connection', ws => this.onConnection(ws))
    await new Promise<void>((resolve, reject) => {
      srv.once('error', reject)
      srv.listen(port, '0.0.0.0', () => { srv.off('error', reject); resolve() })
    })
    this.http = srv
    this.wss = wss
    this.stopped = false
    this.offs.push(this.deps.onChange(() => this.schedulePush()))
    this.deps.trust.on('change', this.onTrust)
    this.offs.push(() => this.deps.trust.off('change', this.onTrust))
    if (this.deps.publish) {
      const m = this.deps.machine()
      this.mdns = this.deps.publish({ name: m.name, port: this.port(), txt: { id: m.id, os: m.os, v: '1' } })
    }
  }

  port(): number {
    const a = this.http?.address()
    return a && typeof a === 'object' ? a.port : 0
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = null
    for (const off of this.offs.splice(0)) off()
    this.window.close()
    this.code = null
    try { this.mdns?.stop() } catch { /* best effort */ }
    this.mdns = null
    for (const l of [...this.live]) l.ch.close('servidor parado')
    for (const ws of this.unauth) ws.terminate()
    this.unauth.clear()
    for (const c of this.wss?.clients ?? []) c.terminate()
    this.wss?.close()
    const srv = this.http
    this.http = null
    this.wss = null
    if (srv) {
      await new Promise<void>(resolve => {
        srv.close(() => resolve())
        srv.closeAllConnections()
      })
    }
  }

  openPairing(): string {
    this.code = this.window.open()
    return this.code
  }

  closePairing(): void {
    this.window.close()
    this.code = null
  }

  clients(): { pub: string; name: string; since: string }[] {
    return [...this.live].map(l => ({ pub: l.ch.peerPub, name: this.deps.trust.get(l.ch.peerPub)?.name ?? l.ch.peer.name, since: l.since }))
  }

  private upgrade(wss: WebSocketServer, req: http.IncomingMessage, sock: Duplex, head: Buffer): void {
    const accept = this.deps.acceptAddress ?? defaultAccept
    let ok = false
    try { ok = accept(req.socket.localAddress ?? '', req.socket.remoteAddress ?? '') } catch { ok = false }
    if (!ok || this.stopped || this.unauth.size >= MAX_UNAUTH) { sock.destroy(); return }
    wss.handleUpgrade(req, sock, head, ws => wss.emit('connection', ws, req))
  }

  private onConnection(ws: WebSocket): void {
    this.unauth.add(ws)
    const idle = setTimeout(() => ws.terminate(), IDLE_MS)
    ws.on('close', () => { clearTimeout(idle); this.unauth.delete(ws) })
    const sock = wsSocket(ws)
    let first: Uint8Array | string | null = null
    let forward: ((d: Uint8Array | string) => void) | null = null
    const buffered: (Uint8Array | string)[] = []
    let pairing = false
    sock.onMessage(d => {
      if (pairing) return // one message per pairing socket; never buffer for it
      if (first === null) {
        first = d
        if (isPair(d)) { pairing = true; this.pair(ws, sock, d as string) }
        else this.channel(ws, replaying(sock, d, cb => { forward = cb; for (const b of buffered.splice(0)) cb(b) }), idle)
      } else if (forward) forward(d)
      else buffered.push(d)
    })
  }

  private pair(ws: WebSocket, sock: Socket, text: string): void {
    const ctx: PairingCtx = { window: this.window, code: this.code, trust: this.deps.trust, machine: this.deps.machine() }
    let res: { reply: string; paired: boolean }
    try { res = handlePair(text, ctx) } catch { res = { reply: JSON.stringify({ t: 'pair-fail', reason: 'código inválido' }), paired: false } }
    try { sock.send(res.reply) } catch { /* peer already gone */ }
    // single-use socket: close politely, then cut it if the peer does not answer
    ws.close()
    setTimeout(() => ws.terminate(), 1000).unref()
    if (res.paired) this.emit('change')
  }

  private channel(ws: WebSocket, sock: Socket, idle: ReturnType<typeof setTimeout>): void {
    const trust = this.deps.trust
    clearTimeout(idle) // acceptChannel has its own handshake timeout
    acceptChannel(sock, trust.ownKey(), pub => !!trust.get(toB64(pub)), this.deps.machine()).then(ch => {
      const entry: Live = { ch, since: new Date().toISOString() }
      // registered in the same tick as the handshake result: the host expects no pushes
      ch.serve((channel, arg) => this.dispatch(ch, channel, arg))
      ch.onPush(() => {})
      if (this.stopped) return ch.close('servidor parado')
      // revoked while the handshake was in flight
      if (!trust.get(ch.peerPub)) return ch.close(REMOVED)
      this.unauth.delete(ws)
      this.live.add(entry)
      ch.onClose(() => { this.live.delete(entry); this.emit('change') })
      trust.touch(ch.peerPub, entry.since)
      this.emit('change')
    }, () => ws.terminate())
  }

  private async dispatch(ch: SecureChannel, channel: string, arg: unknown): Promise<unknown> {
    const dev = this.deps.trust.get(ch.peerPub)
    if (!dev) {
      ch.close(REMOVED)
      throw new Error(REMOVED)
    }
    const state = this.deps.state()
    if (channel === 'state:get') return filterState(state)
    const auth = authorize(channel, arg, state)
    if (!auth.ok) throw new Error(auth.error)
    return this.deps.invoke(channel, auth.arg, { remote: { deviceId: ch.peerPub, terminal: dev.terminal } })
  }

  private readonly onTrust = (): void => {
    for (const l of [...this.live]) if (!this.deps.trust.get(l.ch.peerPub)) l.ch.close(REMOVED)
  }

  private schedulePush(): void {
    if (this.pushTimer || this.stopped) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      if (this.stopped || !this.live.size) return
      const s = filterState(this.deps.state())
      for (const l of this.live) l.ch.push('state', s)
    }, PUSH_DEBOUNCE_MS)
  }
}

function isPair(d: Uint8Array | string): boolean {
  if (typeof d !== 'string') return false
  try {
    const v: unknown = JSON.parse(d)
    return typeof v === 'object' && v !== null && (v as { t?: unknown }).t === 'pair'
  } catch { return false }
}

/** Hands the peeked first message to whoever registers onMessage next, then lets the rest follow. */
function replaying(sock: Socket, first: Uint8Array | string, attach: (cb: (d: Uint8Array | string) => void) => void): Socket {
  return {
    send: d => sock.send(d),
    close: () => sock.close(),
    onClose: cb => sock.onClose(cb),
    onMessage(cb) {
      cb(first)
      attach(cb)
    }
  }
}
