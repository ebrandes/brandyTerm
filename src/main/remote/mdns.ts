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

const log = (e: unknown): void => console.error('[remote] mDNS:', e instanceof Error ? e.message : e)

/** Announces the host on the LAN as `_brandyterm._tcp`. Never throws; failures only disable discovery. */
export const publishMdns: NonNullable<HostDeps['publish']> = info => {
  let bonjour: Bonjour | null = null
  try {
    bonjour = new Bonjour(undefined, log)
    // multicast-dns emits 'error' (EACCES, EADDRINUSE...) on its socket: an unhandled one would crash the app
    const mdns = (bonjour as unknown as { server?: { mdns?: EventEmitter } }).server?.mdns
    mdns?.on('error', log)
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
