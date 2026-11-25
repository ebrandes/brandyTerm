import type { EventEmitter } from 'node:events'
import { Bonjour } from 'bonjour-service'
import type { DiscoveredHost, MachineOs } from '../../shared/remote/machine.ts'
import { isPrivateIPv4 } from './lan.ts'

const log = (e: unknown): void => console.error('[remote] mDNS:', e instanceof Error ? e.message : e)
const OSES: string[] = ['mac', 'windows', 'linux']

interface Svc { name: string; port: number; addresses?: string[]; txt?: unknown }

/** A service as a host, or null: needs an id, a known os and a private IPv4 (never a tunnel or public address). */
export function toDiscovered(s: Svc): DiscoveredHost | null {
  const txt = (s.txt ?? {}) as Record<string, unknown>
  const id = txt.id
  const os = txt.os
  if (typeof id !== 'string' || !id || typeof os !== 'string' || !OSES.includes(os)) return null
  const ip = (s.addresses ?? []).find(isPrivateIPv4)
  if (!ip || !Number.isInteger(s.port) || s.port < 1 || s.port > 65535) return null
  return { name: s.name, os: os as MachineOs, address: `${ip}:${s.port}`, machineId: id }
}

export interface BrowseHandle { stop(): void }
export type Browse = (onUp: (h: DiscoveredHost) => void, onDown: (machineId: string) => void) => BrowseHandle

/** Browses `_brandyterm._tcp` on the LAN. Never throws; failures only disable discovery. */
export const browseMdns: Browse = (onUp, onDown) => {
  let bonjour: Bonjour | null = null
  try {
    bonjour = new Bonjour(undefined, log)
    // multicast-dns emits 'error' on its socket: an unhandled one would crash the app
    ;(bonjour as unknown as { server?: { mdns?: EventEmitter } }).server?.mdns?.on('error', log)
    const browser = bonjour.find({ type: 'brandyterm' })
    ;(browser as unknown as EventEmitter).on('error', log)
    browser.on('up', (s: Svc) => { const h = toDiscovered(s); if (h) onUp(h) })
    browser.on('down', (s: Svc) => {
      const id = (s.txt as { id?: unknown } | undefined)?.id
      if (typeof id === 'string') onDown(id)
    })
  } catch (e) {
    log(e)
  }
  return {
    stop() {
      try { bonjour?.destroy() } catch (e) { log(e) }
      bonjour = null
    }
  }
}
