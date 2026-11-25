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
  /** socket of the handshake in flight, so stop()/revoke can close it */
  sock: Socket | null
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
    const known = new Set(this.deps.trust.list('host').map(d => d.machineId))
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
    const existing = this.entries.get(host.machine.id)
    if (existing) existing.address = address
    this.addresses.set(host.machine.id, address) // before trust.add: its 'change' makes sync() see the address
    this.deps.trust.add({ pub: host.pub, role: 'host', machineId: host.machine.id, name: host.machine.name, os: host.machine.os })
    // a re-paired machine replaces its old key
    this.deps.trust.revokeOthers(host.machine.id, host.pub, 'host')
    this.sync()
    this.retryNow(host.machine.id, address)
    return host.machine
  }

  // ---- connection management ----

  /** Brings entries in line with the trusted hosts and the remembered addresses. */
  private sync(): void {
    if (!this.started) return
    const chosen = new Map<string, TrustedDevice>()
    for (const d of this.deps.trust.list('host')) {
      const cur = chosen.get(d.machineId)
      // the key already in use wins until it is gone; otherwise the latest listed
      if (!cur || this.entries.get(d.machineId)?.device.pub !== cur.pub) chosen.set(d.machineId, d)
    }
    let changed = false
    for (const id of [...this.entries.keys()]) {
      if (chosen.has(id)) continue
      this.drop(id)
      this.addresses.delete(id) // revoked
      changed = true
    }
    for (const [id, d] of chosen) {
      const e = this.entries.get(id)
      if (e) {
        if (e.device.pub !== d.pub) { this.rekey(e, d); changed = true }
        else if (e.device.name !== d.name || e.device.os !== d.os) { e.device = d; changed = true }
        continue
      }
      const address = this.addresses.get(id)
      if (!address) continue
      this.entries.set(id, {
        device: d, address, ch: null, online: false, since: new Date().toISOString(),
        attempt: 0, timer: null, gen: 0, connecting: false, sock: null
      })
      changed = true
      this.connect(id)
    }
    if (changed) this.emit('hosts', this.list())
  }

  /** The machine now has another key: forget the old connection and dial with the new one. */
  private rekey(e: Entry, d: TrustedDevice): void {
    this.release(e)
    e.device = d
    e.attempt = 0
    e.error = undefined
    this.connect(d.machineId)
  }

  private release(e: Entry): void {
    e.gen++
    this.cancel(e)
    e.connecting = false
    e.online = false
    e.sock?.close()
    e.sock = null
    const ch = e.ch
    e.ch = null
    ch?.close('removido')
  }

  private drop(id: string): void {
    const e = this.entries.get(id)
    if (!e) return
    this.entries.delete(id)
    this.release(e)
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
      e.address = address // persisted only once a handshake succeeds there
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
    e.sock = sock
    connectChannel(sock, this.deps.own, fromB64(e.device.pub), this.me()).then(
      ch => this.connected(id, gen, ch),
      err => this.failed(id, gen, err)
    )
  }

  private connected(id: string, gen: number, ch: SecureChannel): void {
    const e = this.entries.get(id)
    if (!e || e.gen !== gen || !this.started) return ch.close('descartado')
    e.connecting = false
    e.sock = null
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
    this.addresses.set(id, e.address)
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
    e.sock = null
    const msg = err instanceof Error ? err.message : String(err)
    e.error = msg === 'versão diferente' ? `atualize o BrandyTerm em ${e.device.name}` : msg
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
