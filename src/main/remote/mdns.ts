import type { EventEmitter } from 'node:events'
import os from 'node:os'
import { Bonjour } from 'bonjour-service'
import type { HostDeps } from './server.ts'
import { lanAddresses } from './lan.ts'

interface Rec { name: string; type: string; ttl?: number; data?: unknown }

/** Replaces every address record with the LAN addresses only (no VPN/tunnel IP is multicast). */
export function lanOnlyRecords(records: Rec[], host: string, addrs: string[]): Rec[] {
  return [
    ...records.filter(r => r.type !== 'A' && r.type !== 'AAAA'),
    ...addrs.map(data => ({ name: host, type: 'A', ttl: 120, data }))
  ]
}

/** Socket options that keep mDNS on the LAN: the group is joined and multicast sent on the first LAN
 * interface only (never a VPN or tunnel). No LAN address: null, and no mDNS socket at all. */
export function mdnsOptions(lan: string[]): { interface: string; bind: string } | null {
  return lan.length ? { interface: lan[0], bind: '0.0.0.0' } : null
}

export const log = (e: unknown): void => console.error('[remote] mDNS:', e instanceof Error ? e.message : e)

/** A Bonjour bound to the LAN interface, or null when there is none. Throws like `new Bonjour`. */
export function lanBonjour(): Bonjour | null {
  const opts = mdnsOptions(lanAddresses(os.networkInterfaces()))
  if (!opts) return null
  // the typings only list service fields; these go to multicast-dns
  const bonjour = new Bonjour(opts as unknown as ConstructorParameters<typeof Bonjour>[0], log)
  // multicast-dns emits 'error' (EACCES, EADDRINUSE...) on its socket: an unhandled one would crash the app
  ;(bonjour as unknown as { server?: { mdns?: EventEmitter } }).server?.mdns?.on('error', log)
  return bonjour
}

/** Announces the host on the LAN as `_brandyterm._tcp`. Never throws; failures only disable discovery. */
export const publishMdns: NonNullable<HostDeps['publish']> = info => {
  let bonjour: Bonjour | null = null
  try {
    bonjour = lanBonjour()
    if (!bonjour) return { stop() {} }
    const svc = bonjour.publish({ name: info.name, type: 'brandyterm', port: info.port, txt: info.txt })
    // records() runs after the probe, so this override is in place before anything is announced
    const original = svc.records.bind(svc) as () => Rec[]
    ;(svc as unknown as { records: () => Rec[] }).records = () =>
      lanOnlyRecords(original(), svc.host, lanAddresses(os.networkInterfaces()))
  } catch (e) {
    log(e)
  }
  return {
    stop() {
      try { bonjour?.unpublishAll(); bonjour?.destroy() } catch (e) { log(e) }
      bonjour = null
    }
  }
}
