// Connections from this machine to the hosts it paired with. Keys stay here, in the main process.
import { EventEmitter } from 'node:events'
import { connectChannel, type SecureChannel } from '../../shared/remote/channel.ts'
import { fromB64, toB64, type KeyPair } from '../../shared/remote/crypto.ts'
import type { DiscoveredHost, MachineInfo, RemoteHostInfo, TrustedDevice } from '../../shared/remote/machine.ts'
import type { Socket } from '../../shared/remote/protocol.ts'
import type { AppState } from '../../shared/types.ts'
import type { Browse, BrowseHandle } from './browse.ts'
import { HostAddresses } from './host-addresses.ts'
import { pairWithHost } from './host-pair-client.ts'
import type { TrustStore } from './trust.ts'

export const RETRY_MS = [1000, 2000, 4000, 8000, 16000, 30000]

export interface HostsDeps {
  trust: TrustStore
  own: KeyPair
  me: MachineInfo | (() => MachineInfo)
  dial: (address: string) => Socket
  /** where remote-hosts.json lives */
  dir: string
  browse?: Browse
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (h: unknown) => void
}

interface Entry {
  device: TrustedDevice
  address: string
  ch: SecureChannel | null
  online: boolean
  since: string
  error?: string
  attempt: number
  timer: unknown
  gen: number
  connecting: boolean
}

export class RemoteHosts extends EventEmitter {
  private readonly deps: HostsDeps
  private readonly addresses: HostAddresses
  private readonly entries = new Map<string, Entry>()
  private readonly seen = new Map<string, DiscoveredHost>()
  private readonly pairing = new Set<Socket>()
  private browser: BrowseHandle | null = null
  private started = false
  private readonly setT: (fn: () => void, ms: number) => unknown
  private readonly clearT: (h: unknown) => void
  private readonly onTrust = (): void => this.sync()

  constructor(deps: HostsDeps) {
    super()
    this.deps = deps
    this.addresses = new HostAddresses(deps.dir)
    this.setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearT = deps.clearTimeout ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  private me(): MachineInfo { return typeof this.deps.me === 'function' ? this.deps.me() : this.deps.me }

  start(): void {
    if (this.started) return
    this.started = true
    this.deps.trust.on('change', this.onTrust)
    if (this.deps.browse) {
      this.browser = this.deps.browse(h => this.onSeen(h), id => { this.seen.delete(id) })
    }
    this.sync()
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.deps.trust.off('change', this.onTrust)
    this.browser?.stop()
    this.browser = null
    for (const id of [...this.entries.keys()]) this.drop(id)
    for (const s of this.pairing) { try { s.close() } catch { /* already closed */ } }
    this.pairing.clear()
    this.seen.clear()
  }

  list(): RemoteHostInfo[] {
    return [...this.entries.values()].map(e => ({
      machine: { id: e.device.machineId, name: e.device.name, os: e.device.os === 'phone' ? 'linux' : e.device.os },
      online: e.online,
      ...(e.online ? {} : { since: e.since }),
      address: e.address,
      ...(e.error ? { error: e.error } : {})
    }))
  }

  /** Hosts seen on the LAN that are not paired (and not this machine). */
  discovered(): DiscoveredHost[] {
    const known = new Set(this.deps.trust.list().map(d => d.machineId))
    return [...this.seen.values()].filter(h => !known.has(h.machineId) && h.machineId !== this.me().id)
  }

  call(machineId: string, channel: string, arg: unknown): Promise<unknown> {
    const e = this.entries.get(machineId)
    if (!e) return Promise.reject(new Error('Máquina desconhecida'))
    if (!e.online || !e.ch) return Promise.reject(new Error(`${e.device.name} está offline`))
    return e.ch.request(channel, arg)
  }

  async pair(address: string, code: string): Promise<MachineInfo> {
    const own = this.deps.own
    const sockets = this.pairing
    const dial = (a: string): Socket => {
      const s = this.deps.dial(a)
      sockets.add(s)
      const close = s.close.bind(s)
      s.close = () => { sockets.delete(s); close() }
      return s
    }
    const host = await pairWithHost(
      { dial, ownPub: own.pub, me: this.me(), setTimeout: this.setT, clearTimeout: this.clearT },
      address, code
    )
    this.addresses.set(host.machine.id, address) // before trust.add: its 'change' makes sync() see the address
    this.deps.trust.add({ pub: host.pub, machineId: host.machine.id, name: host.machine.name, os: host.machine.os })
    this.sync()
    this.retryNow(host.machine.id, address)
    return host.machine
  }

  // ---- connection management ----

  /** Brings entries in line with the trust store and the remembered addresses. */
  private sync(): void {
    if (!this.started) return
    const devices = this.deps.trust.list()
    let changed = false
    for (const [id, e] of [...this.entries]) {
      const still = devices.find(d => d.machineId === id && d.pub === e.device.pub)
      if (!still) {
        this.drop(id)
        // a re-pair under a new key keeps the address; a revoke forgets it
        if (!devices.some(d => d.machineId === id)) this.addresses.delete(id)
        changed = true
      }
    }
    for (const d of devices) {
      const address = this.addresses.get(d.machineId)
      if (!address) continue
      const e = this.entries.get(d.machineId)
      if (e) {
        if (e.device.name !== d.name || e.device.os !== d.os) { e.device = d; changed = true }
        continue
      }
      this.entries.set(d.machineId, {
        device: d, address, ch: null, online: false, since: new Date().toISOString(),
        attempt: 0, timer: null, gen: 0, connecting: false
      })
      changed = true
      this.connect(d.machineId)
    }
    if (changed) this.emit('hosts', this.list())
  }

  private drop(id: string): void {
    const e = this.entries.get(id)
    if (!e) return
    this.entries.delete(id)
    e.gen++
    this.cancel(e)
    e.ch?.close('removido')
    e.ch = null
  }

  private cancel(e: Entry): void {
    if (e.timer !== null) this.clearT(e.timer)
    e.timer = null
  }

  private onSeen(h: DiscoveredHost): void {
    this.seen.set(h.machineId, h)
    this.emit('discovered', this.discovered())
    const e = this.entries.get(h.machineId)
    if (e) this.retryNow(h.machineId, h.address)
  }

  /** Remembers the (possibly new) address and retries at once unless already connected. */
  private retryNow(id: string, address: string): void {
    const e = this.entries.get(id)
    if (!e) return
    if (e.address !== address) {
      e.address = address
      this.addresses.set(id, address)
      this.emit('hosts', this.list())
    }
    if (e.online || e.connecting) return
    this.cancel(e)
    this.connect(id)
  }

  private connect(id: string): void {
    const e = this.entries.get(id)
    if (!e || !this.started || e.connecting || e.ch) return
    e.connecting = true
    const gen = ++e.gen
    let sock: Socket
    try { sock = this.deps.dial(e.address) } catch (err) { return this.failed(id, gen, err) }
    connectChannel(sock, this.deps.own, fromB64(e.device.pub), this.me()).then(
      ch => this.connected(id, gen, ch),
      err => this.failed(id, gen, err)
    )
  }

  private connected(id: string, gen: number, ch: SecureChannel): void {
    const e = this.entries.get(id)
    if (!e || e.gen !== gen || !this.started) return ch.close('descartado')
    e.connecting = false
    // the client serves nothing; pushes are the host's state
    ch.serve(() => { throw new Error('sem handler') })
    ch.onPush((topic, payload) => {
      if (topic === 'state' && e.ch === ch && typeof payload === 'object' && payload !== null) {
        this.emit('state', { machineId: id, state: payload as AppState })
      }
    })
    ch.onClose(() => this.closed(id, gen, ch))
    // identity is the trusted key; the self-reported id must still agree with it
    if (ch.peer.id !== e.device.machineId || toB64(fromB64(ch.peerPub)) !== e.device.pub) {
      e.error = 'identidade não confere'
      e.ch = ch
      ch.close('identidade não confere')
      return
    }
    e.ch = ch
    e.online = true
    e.error = undefined
    e.attempt = 0
    this.emit('hosts', this.list())
  }

  private closed(id: string, gen: number, ch: SecureChannel): void {
    const e = this.entries.get(id)
    if (!e || e.gen !== gen || e.ch !== ch) return
    e.ch = null
    e.connecting = false
    if (e.online) e.since = new Date().toISOString()
    e.online = false
    this.schedule(e, id)
    this.emit('hosts', this.list())
  }

  private failed(id: string, gen: number, err: unknown): void {
    const e = this.entries.get(id)
    if (!e || e.gen !== gen) return
    e.connecting = false
    e.error = err instanceof Error ? err.message : String(err)
    this.schedule(e, id)
    this.emit('hosts', this.list())
  }

  private schedule(e: Entry, id: string): void {
    if (!this.started) return
    this.cancel(e)
    const delay = RETRY_MS[Math.min(e.attempt, RETRY_MS.length - 1)]
    e.attempt++
    e.timer = this.setT(() => {
      e.timer = null
      this.connect(id)
    }, delay)
  }
}
