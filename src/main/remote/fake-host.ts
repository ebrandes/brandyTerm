// Test double: a host reachable through in-memory sockets (plain pairing and encrypted channel).
import { acceptChannel, type SecureChannel } from '../../shared/remote/channel.ts'
import { toB64 } from '../../shared/remote/crypto.ts'
import type { MachineInfo } from '../../shared/remote/machine.ts'
import { PairingWindow } from '../../shared/remote/pairing.ts'
import type { Socket } from '../../shared/remote/protocol.ts'
import { handlePair } from './host-pairing.ts'
import type { TrustStore } from './trust.ts'

type Data = Uint8Array | string

class End implements Socket {
  peer!: End
  closed = false
  private cb: ((d: Data) => void) | null = null
  private closeCb: (() => void) | null = null
  private queue: Data[] = []
  send(d: Data): void {
    if (this.closed) return
    queueMicrotask(() => this.peer.deliver(d))
  }
  deliver(d: Data): void {
    if (this.closed) return
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

export function endPair(): [Socket, Socket] {
  const a = new End()
  const b = new End()
  a.peer = b
  b.peer = a
  return [a, b]
}

/** A socket that never connects: closes right away. */
export function deadSocket(): Socket {
  return { send() {}, onMessage() {}, onClose(cb) { queueMicrotask(cb) }, close() {} }
}

export class FakeHost {
  readonly window = new PairingWindow(() => Date.now())
  readonly channels: SecureChannel[] = []
  code: string | null = null
  down = false
  tamper = false
  dials = 0
  private readonly info: MachineInfo
  private readonly trust: TrustStore
  constructor(trust: TrustStore, info: MachineInfo) {
    this.trust = trust
    this.info = info
  }

  openPairing(): string { return (this.code = this.window.open()) }

  dial: (address: string) => Socket = (_address: string): Socket => {
    this.dials++
    if (this.down) return deadSocket()
    const [client, host] = endPair()
    let first = true
    host.onMessage(d => {
      if (!first) return
      first = false
      if (typeof d === 'string' && d.includes('"t":"pair"')) return this.pair(host, d)
      const replay: Socket = {
        send: x => host.send(x),
        onMessage: cb => { cb(d); host.onMessage(cb) },
        onClose: cb => host.onClose(cb),
        close: () => host.close()
      }
      void acceptChannel(replay, this.trust.ownKey(), pub => !!this.trust.get(toB64(pub), 'client'), this.info).then(ch => {
        this.channels.push(ch)
        ch.serve(async (channel, arg) => {
          if (channel === 'hang') return new Promise(() => {})
          return { channel, arg }
        })
        ch.onPush(() => {})
      }, () => {})
    })
    return client
  }

  private pair(host: Socket, text: string): void {
    const r = handlePair(text, { window: this.window, code: this.code, trust: this.trust, machine: this.info })
    let reply = r.reply
    if (this.tamper) {
      const o = JSON.parse(reply) as { proof?: string }
      if (o.proof) o.proof = o.proof.replace(/^./, c => (c === 'A' ? 'B' : 'A'))
      reply = JSON.stringify(o)
    }
    host.send(reply)
  }
}
