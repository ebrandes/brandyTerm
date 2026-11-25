// Wire frames exchanged over an encrypted session. Pure: no Node or Electron APIs.
import type { MachineInfo } from './machine.ts'

export const PROTOCOL_VERSION = 1

export type Frame =
  | { k: 'req'; id: number; channel: string; arg: unknown }
  | { k: 'res'; id: number; ok: true; value: unknown }
  | { k: 'res'; id: number; ok: false; error: string }
  | { k: 'push'; topic: string; payload: unknown }
  | { k: 'hello'; protocol: number; machine: MachineInfo }

export interface Socket {
  send(data: Uint8Array | string): void
  onMessage(cb: (data: Uint8Array | string) => void): void
  onClose(cb: () => void): void
  close(): void
}

const OSES = ['mac', 'windows', 'linux']

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function machineOf(v: unknown): MachineInfo | null {
  if (!isObj(v)) return null
  if (typeof v.id !== 'string' || typeof v.name !== 'string') return null
  if (typeof v.os !== 'string' || !OSES.includes(v.os)) return null
  return { id: v.id, name: v.name, os: v.os as MachineInfo['os'] }
}

export function decodeFrame(json: string): Frame | null {
  let v: unknown
  try { v = JSON.parse(json) } catch { return null }
  if (!isObj(v)) return null
  switch (v.k) {
    case 'req':
      if (!Number.isInteger(v.id) || typeof v.channel !== 'string') return null
      return { k: 'req', id: v.id as number, channel: v.channel, arg: v.arg }
    case 'res':
      if (!Number.isInteger(v.id) || typeof v.ok !== 'boolean') return null
      if (v.ok) return { k: 'res', id: v.id as number, ok: true, value: v.value }
      if (typeof v.error !== 'string') return null
      return { k: 'res', id: v.id as number, ok: false, error: v.error }
    case 'push':
      if (typeof v.topic !== 'string') return null
      return { k: 'push', topic: v.topic, payload: v.payload }
    case 'hello': {
      const machine = machineOf(v.machine)
      if (typeof v.protocol !== 'number' || !machine) return null
      return { k: 'hello', protocol: v.protocol, machine }
    }
    default:
      return null
  }
}
