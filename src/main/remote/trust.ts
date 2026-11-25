// Trusted devices + this machine's static key. Directory is injected so tests need no Electron.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { join } from 'node:path'
import { newKeyPair, toB64, fromB64, type KeyPair } from '../../shared/remote/crypto.ts'
import { writeAtomic, keepCorrupt } from '../atomic-write.ts'
import type { TrustedDevice, TrustRole } from '../../shared/remote/machine.ts'

export type { TrustedDevice, TrustRole }

export class TrustStore extends EventEmitter {
  private readonly keyFile: string
  private readonly trustFile: string
  private key: KeyPair | null = null
  private devices: TrustedDevice[]

  constructor(dir: string) {
    super()
    fs.mkdirSync(dir, { recursive: true })
    this.keyFile = join(dir, 'remote-key.json')
    this.trustFile = join(dir, 'remote-trust.json')
    this.devices = this.load()
  }

  private load(): TrustedDevice[] {
    try {
      const v = JSON.parse(fs.readFileSync(this.trustFile, 'utf8'))
      // entries written before roles existed were all clients
      if (Array.isArray(v)) return v.map(d => ({ ...d, role: d.role === 'host' ? 'host' : 'client' }))
    } catch { /* missing or corrupt */ }
    keepCorrupt(this.trustFile)
    return []
  }

  private save(): void {
    writeAtomic(this.trustFile, JSON.stringify(this.devices, null, 2))
    this.emit('change')
  }

  ownKey(): KeyPair {
    if (this.key) return this.key
    try {
      const j = JSON.parse(fs.readFileSync(this.keyFile, 'utf8'))
      const k = { pub: fromB64(j.pub), priv: fromB64(j.priv) }
      if (k.pub.length === 32 && k.priv.length === 32) return (this.key = k)
    } catch { /* missing or corrupt: generate */ }
    keepCorrupt(this.keyFile)
    const k = newKeyPair()
    writeAtomic(this.keyFile, JSON.stringify({ pub: toB64(k.pub), priv: toB64(k.priv) }), 0o600)
    return (this.key = k)
  }

  list(role?: TrustRole): TrustedDevice[] {
    return this.devices.filter(d => !role || d.role === role).map(d => ({ ...d }))
  }

  get(pub: string, role: TrustRole): TrustedDevice | undefined {
    const d = this.devices.find(x => x.pub === pub && x.role === role)
    return d && { ...d }
  }

  /** Unique per (pub, role): the same machine may be both a client and a host. */
  add(d: Omit<TrustedDevice, 'addedAt' | 'terminal'>): TrustedDevice {
    const prev = this.devices.find(x => x.pub === d.pub && x.role === d.role)
    const next: TrustedDevice = {
      pub: d.pub, role: d.role, machineId: d.machineId, name: d.name, os: d.os,
      ...(d.lastSeen ? { lastSeen: d.lastSeen } : {}),
      addedAt: prev?.addedAt ?? new Date().toISOString(),
      terminal: prev?.terminal ?? false
    }
    this.devices = [...this.devices.filter(x => !(x.pub === d.pub && x.role === d.role)), next]
    this.save()
    return { ...next }
  }

  /** Role omitted: both roles. */
  revoke(pub: string, role?: TrustRole): void {
    const n = this.devices.length
    this.devices = this.devices.filter(x => !(x.pub === pub && (!role || x.role === role)))
    if (this.devices.length !== n) this.save()
  }

  /** Drops the other keys of a machine in one role (a re-paired machine replaces its old key). */
  revokeOthers(machineId: string, keepPub: string, role: TrustRole): void {
    const n = this.devices.length
    this.devices = this.devices.filter(x => !(x.machineId === machineId && x.role === role && x.pub !== keepPub))
    if (this.devices.length !== n) this.save()
  }

  touch(pub: string, iso: string): void {
    const d = this.devices.find(x => x.pub === pub && x.role === 'client')
    if (!d) return
    d.lastSeen = iso
    this.save()
  }

  setTerminal(pub: string, on: boolean): void {
    const d = this.devices.find(x => x.pub === pub && x.role === 'client')
    if (!d || d.terminal === on) return
    d.terminal = on
    this.save()
  }
}
