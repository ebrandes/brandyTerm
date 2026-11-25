// Request/response/push channel over an encrypted session. Pure: works over any Socket.
import {
  FrameCipher, fromB64, initiatorFinish, initiatorStart, responderReply, toB64,
  type Hello1, type Hello2, type KeyPair, type SessionKeys
} from './crypto.ts'
import type { MachineInfo } from './machine.ts'
import { decodeFrame, PROTOCOL_VERSION, type Frame, type Socket } from './protocol.ts'

const enc = new TextEncoder()
const dec = new TextDecoder()

function asBytes(data: unknown): Uint8Array | null {
  if (!(data instanceof Uint8Array)) return null
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

const MAX_QUEUED = 256
const encode = (f: Frame): Uint8Array => enc.encode(JSON.stringify(f))

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

export class SecureChannel {
  private nextId = 0
  private closed = false
  private readonly pending = new Map<number, Pending>()
  private handler: ((channel: string, arg: unknown) => Promise<unknown>) | null = null
  private pushCb: ((topic: string, payload: unknown) => void) | null = null
  private readonly closeCbs: ((reason: string) => void)[] = []
  private closeReason = ''
  private readonly inboxReq: Extract<Frame, { k: 'req' }>[] = []
  private readonly inboxPush: Extract<Frame, { k: 'push' }>[] = []

  private readonly sock: Socket
  private readonly cipher: FrameCipher
  readonly peer: MachineInfo
  readonly peerPub: string

  constructor(sock: Socket, cipher: FrameCipher, peer: MachineInfo, peerPub: string) {
    this.sock = sock
    this.cipher = cipher
    this.peer = peer
    this.peerPub = peerPub
  }

  request(channel: string, arg: unknown, timeoutMs = 60_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Máquina desconectada'))
    const id = ++this.nextId
    let bytes: Uint8Array
    try { bytes = encode({ k: 'req', id, channel, arg }) } catch (e) { return Promise.reject(e) }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('sem resposta'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.transmit(bytes)
    })
  }

  serve(h: (channel: string, arg: unknown) => Promise<unknown>): void {
    this.handler = h
    queueMicrotask(() => this.flush())
  }

  onPush(cb: (topic: string, payload: unknown) => void): void {
    this.pushCb = cb
    queueMicrotask(() => this.flush())
  }

  onClose(cb: (reason: string) => void): void {
    if (this.closed) { try { cb(this.closeReason) } catch { /* ignore */ } }
    else this.closeCbs.push(cb)
  }

  push(topic: string, payload: unknown): void { this.send({ k: 'push', topic, payload }) }

  close(reason = 'encerrado'): void {
    if (this.closed) return
    this.closed = true
    this.closeReason = reason
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error('Máquina desconectada'))
    }
    this.pending.clear()
    try { this.sock.close() } catch { /* already closed */ }
    this.inboxReq.length = 0
    this.inboxPush.length = 0
    for (const cb of this.closeCbs.splice(0)) {
      try { cb(reason) } catch { /* a throwing callback must not stop the others */ }
    }
  }

  /** Called by the socket wiring; not part of the public API. */
  receive(data: Uint8Array | string): void {
    if (this.closed) return
    const bytes = asBytes(data)
    if (!bytes) return this.close('quadro inválido')
    let frame: Frame | null
    try { frame = decodeFrame(dec.decode(this.cipher.open(bytes))) } catch { frame = null }
    if (!frame || frame.k === 'hello') return this.close('quadro inválido')
    if (frame.k === 'res') this.onResponse(frame)
    else if (frame.k === 'push') this.inboxPush.push(frame)
    else this.inboxReq.push(frame)
    if (this.inboxReq.length + this.inboxPush.length > MAX_QUEUED) return this.close('fila cheia')
    this.flush()
  }

  // Requests and pushes wait here until serve()/onPush() is registered, then run in arrival order.
  private flush(): void {
    while (!this.closed && this.pushCb && this.inboxPush.length) {
      const f = this.inboxPush.shift()!
      try { this.pushCb(f.topic, f.payload) } catch { /* a throwing callback must not reach the transport */ }
    }
    while (!this.closed && this.handler && this.inboxReq.length) this.onRequest(this.inboxReq.shift()!)
  }

  /** Called by the socket wiring; not part of the public API. */
  socketClosed(): void { this.close('conexão encerrada') }

  private onResponse(f: Extract<Frame, { k: 'res' }>): void {
    const p = this.pending.get(f.id)
    if (!p) return
    this.pending.delete(f.id)
    clearTimeout(p.timer)
    if (f.ok) p.resolve(f.value)
    else p.reject(new Error(f.error))
  }

  private onRequest(f: Extract<Frame, { k: 'req' }>): void {
    const h = this.handler!
    const fail = (error: string): void => this.send({ k: 'res', id: f.id, ok: false, error })
    Promise.resolve()
      .then(() => h(f.channel, f.arg))
      .then(
        value => {
          try { this.send({ k: 'res', id: f.id, ok: true, value }) } catch { fail('resposta inválida') }
        },
        (err: unknown) => fail(err instanceof Error ? err.message : String(err))
      )
  }

  /** Encodes outside the transport guard: a bad value throws to the caller instead of closing the channel. */
  private send(frame: Frame): void {
    if (this.closed) return
    this.transmit(encode(frame))
  }

  private transmit(bytes: Uint8Array): void {
    if (this.closed) return
    try { this.sock.send(this.cipher.seal(bytes)) } catch { this.close('falha ao enviar') }
  }
}

interface Role {
  /** First text message to send, if this side speaks first. */
  start?: string
  /** Handles the peer's handshake text; returns session keys, an optional reply and the peer key. */
  onText(text: string): { keys: SessionKeys; reply?: string; peerPub: string }
}

function establish(sock: Socket, me: MachineInfo, timeoutMs: number, role: Role): Promise<SecureChannel> {
  return new Promise((resolve, reject) => {
    let cipher: FrameCipher | null = null
    let peerPub = ''
    let channel: SecureChannel | null = null
    let settled = false
    const fail = (msg: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { sock.close() } catch { /* already closed */ }
      reject(new Error(msg))
    }
    const timer = setTimeout(() => fail('sem resposta'), timeoutMs)

    const onText = (data: Uint8Array | string): void => {
      if (typeof data !== 'string') return fail('mensagem inválida')
      try {
        const r = role.onText(data)
        cipher = new FrameCipher(r.keys)
        peerPub = r.peerPub
        if (r.reply) sock.send(r.reply)
        const hello: Frame = { k: 'hello', protocol: PROTOCOL_VERSION, machine: me }
        sock.send(cipher.seal(encode(hello)))
      } catch (e) {
        cipher = null
        fail(e instanceof Error && e.message === 'não confiável' ? e.message : 'handshake inválido')
      }
    }

    const onHello = (c: FrameCipher, data: Uint8Array | string): void => {
      const bytes = asBytes(data)
      let f: Frame | null = null
      try { if (bytes) f = decodeFrame(dec.decode(c.open(bytes))) } catch { f = null }
      if (!f || f.k !== 'hello') return fail('quadro inválido')
      if (f.protocol !== PROTOCOL_VERSION) return fail('versão diferente')
      settled = true
      clearTimeout(timer)
      channel = new SecureChannel(sock, c, f.machine, peerPub)
      resolve(channel)
    }

    sock.onMessage(data => {
      if (channel) channel.receive(data)
      else if (settled) return
      else if (!cipher) onText(data)
      else onHello(cipher, data)
    })
    sock.onClose(() => {
      if (channel) channel.socketClosed()
      else fail('conexão encerrada')
    })
    try { if (role.start) sock.send(role.start) } catch { fail('conexão encerrada') }
  })
}

function parseJson(text: string): Record<string, unknown> {
  const v: unknown = JSON.parse(text)
  if (typeof v !== 'object' || v === null) throw new Error('formato')
  return v as Record<string, unknown>
}

export function connectChannel(
  sock: Socket, own: KeyPair, peerPub: Uint8Array, me: MachineInfo, timeoutMs = 2000
): Promise<SecureChannel> {
  const { msg, e } = initiatorStart(own)
  return establish(sock, me, timeoutMs, {
    start: JSON.stringify(msg),
    onText(text) {
      const o = parseJson(text)
      if (typeof o.re !== 'string') throw new Error('formato')
      const keys = initiatorFinish(own, e, peerPub, { re: o.re } as Hello2)
      return { keys, peerPub: toB64(peerPub) }
    }
  })
}

export function acceptChannel(
  sock: Socket, own: KeyPair, trusted: (pub: Uint8Array) => boolean, me: MachineInfo, timeoutMs = 2000
): Promise<SecureChannel> {
  return establish(sock, me, timeoutMs, {
    onText(text) {
      const o = parseJson(text)
      if (typeof o.ie !== 'string' || typeof o.is !== 'string') throw new Error('formato')
      const r = responderReply(own, { ie: o.ie, is: o.is } as Hello1, trusted)
      if (!r) throw new Error('não confiável')
      return { keys: r.keys, reply: JSON.stringify(r.msg), peerPub: toB64(fromB64(o.is)) }
    }
  })
}
