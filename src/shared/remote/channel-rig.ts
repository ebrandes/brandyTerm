// Test rig for the secure channel: an in-memory socket pair and a connected pair of channels (not a test itself).
import { acceptChannel, connectChannel, type SecureChannel } from './channel.ts'
import { FrameCipher, newKeyPair } from './crypto.ts'
import type { MachineInfo } from './machine.ts'
import type { Frame, Socket } from './protocol.ts'

export type Data = Uint8Array | string

export class End implements Socket {
  peer!: End
  closed = false
  private cb: ((d: Data) => void) | null = null
  private closeCb: (() => void) | null = null
  private queue: Data[] = []
  private readonly wrap: (d: Data) => Data
  constructor(wrap: (d: Data) => Data) { this.wrap = wrap }
  send(data: Data): void {
    if (this.closed) return
    const d = this.wrap(data)
    queueMicrotask(() => this.peer.deliver(d))
  }
  hold = false
  private held: Data[] = []
  /** Delivers everything held back in one synchronous batch, like a transport that coalesces reads. */
  release(): void {
    this.hold = false
    for (const d of this.held.splice(0)) this.cb?.(d)
  }
  deliver(d: Data): void {
    if (this.closed) return
    if (this.hold && typeof d !== 'string') { this.held.push(d); return }
    if (this.cb) this.cb(d)
    else this.queue.push(d)
  }
  onMessage(cb: (d: Data) => void): void {
    this.cb = cb
    for (const d of this.queue.splice(0)) cb(d)
  }
  onClose(cb: () => void): void { this.closeCb = cb }
  close(): void {
    if (this.closed) return
    this.closed = true
    this.closeCb?.()
    queueMicrotask(() => this.peer.close())
  }
}

export const identity = (d: Data): Data => d
// Delivers binary frames as Node Buffers that are views into a larger ArrayBuffer (nonzero byteOffset).
export function asBufferView(d: Data): Data {
  if (typeof d === 'string') return d
  const ab = new ArrayBuffer(d.length + 13)
  new Uint8Array(ab).set(d, 7)
  return Buffer.from(ab, 7, d.length)
}

export function pair(wrap: (d: Data) => Data = identity): [End, End] {
  const a = new End(wrap)
  const b = new End(wrap)
  a.peer = b
  b.peer = a
  return [a, b]
}

export const clientInfo: MachineInfo = { id: 'c', name: 'Cliente', os: 'mac' }
export const serverInfo: MachineInfo = { id: 's', name: 'Servidor', os: 'linux' }
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function connected(wrap?: (d: Data) => Data): Promise<{ client: SecureChannel; server: SecureChannel }> {
  const [a, b] = pair(wrap)
  const ck = newKeyPair()
  const sk = newKeyPair()
  const [client, server] = await Promise.all([
    connectChannel(a, ck, sk.pub, clientInfo),
    acceptChannel(b, sk, () => true, serverInfo)
  ])
  return { client, server }
}

// A raw peer that speaks the handshake by hand so it can send arbitrary hello frames.
export function helloBytes(cipher: FrameCipher, protocol: number, machine: MachineInfo): Uint8Array {
  const f: Frame = { k: 'hello', protocol, machine }
  return cipher.seal(new TextEncoder().encode(JSON.stringify(f)))
}
