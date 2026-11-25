// Pairing wire messages and their strict parsers. Pure: runs in Node and in browsers.
import { fromB64 } from './crypto.ts'
import type { MachineInfo, MachineOs } from './machine.ts'
import { NONCE_LEN } from './pairing.ts'

export type PairOs = MachineOs | 'phone'
export type PairFailReason = 'código inválido' | 'pareamento fechado' | 'versão diferente'

export interface PairMsg {
  t: 'pair'
  cpub: string
  nonceC: string
  proof: string
  machineId: string
  name: string
  os: PairOs
  protocol: number
}
export interface PairedMsg {
  t: 'paired'
  hpub: string
  nonceH: string
  proof: string
  machineId: string
  name: string
  os: MachineOs
}
export interface PairFailMsg { t: 'pair-fail'; reason: PairFailReason }

const PUB_LEN = 32
const OSES: string[] = ['mac', 'windows', 'linux']
const REASONS: string[] = ['código inválido', 'pareamento fechado', 'versão diferente']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function bytesOk(v: unknown, len: number): v is string {
  if (typeof v !== 'string') return false
  try { return fromB64(v).length === len } catch { return false }
}
function textOk(v: unknown): v is string { return typeof v === 'string' && v.length >= 1 && v.length <= 64 }
/** the id identity.ts makes (randomUUID): it names folders on the peer, so nothing else is accepted */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function idOk(v: unknown): v is string { return typeof v === 'string' && UUID.test(v) }
function proofOk(v: unknown): v is string {
  if (typeof v !== 'string') return false
  try { fromB64(v); return true } catch { return false }
}

function parseObj(text: string): Record<string, unknown> | null {
  let v: unknown
  try { v = JSON.parse(text) } catch { return null }
  return isObj(v) ? v : null
}

export function parsePair(text: string): PairMsg | null {
  const o = parseObj(text)
  if (!o || o.t !== 'pair') return null
  if (!bytesOk(o.cpub, PUB_LEN) || !bytesOk(o.nonceC, NONCE_LEN) || !proofOk(o.proof)) return null
  if (!idOk(o.machineId) || !textOk(o.name)) return null
  if (typeof o.os !== 'string' || ![...OSES, 'phone'].includes(o.os)) return null
  if (typeof o.protocol !== 'number') return null
  return {
    t: 'pair', cpub: o.cpub, nonceC: o.nonceC, proof: o.proof,
    machineId: o.machineId, name: o.name, os: o.os as PairOs, protocol: o.protocol
  }
}

export function parsePaired(text: string): PairedMsg | null {
  const o = parseObj(text)
  if (!o || o.t !== 'paired') return null
  if (!bytesOk(o.hpub, PUB_LEN) || !bytesOk(o.nonceH, NONCE_LEN) || !proofOk(o.proof)) return null
  if (!idOk(o.machineId) || !textOk(o.name)) return null
  if (typeof o.os !== 'string' || !OSES.includes(o.os)) return null
  return {
    t: 'paired', hpub: o.hpub, nonceH: o.nonceH, proof: o.proof,
    machineId: o.machineId, name: o.name, os: o.os as MachineOs
  }
}

export function parsePairFail(text: string): PairFailMsg | null {
  const o = parseObj(text)
  if (!o || o.t !== 'pair-fail') return null
  if (typeof o.reason !== 'string' || !REASONS.includes(o.reason)) return null
  return { t: 'pair-fail', reason: o.reason as PairFailReason }
}

export function pairedMsg(hpub: string, nonceH: string, proof: string, m: MachineInfo): PairedMsg {
  return { t: 'paired', hpub, nonceH, proof, machineId: m.id, name: m.name, os: m.os }
}
