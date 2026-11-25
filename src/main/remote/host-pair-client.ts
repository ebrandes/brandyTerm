// Client side of the pairing exchange (see shared/remote/pair-wire.ts), over a plain socket.
import { randomBytes } from '@noble/hashes/utils'
import { fromB64, toB64 } from '../../shared/remote/crypto.ts'
import type { MachineInfo } from '../../shared/remote/machine.ts'
import { parsePaired, parsePairFail, type PairMsg } from '../../shared/remote/pair-wire.ts'
import { clientProof, NONCE_LEN, normalizeCode, verifyHostProof } from '../../shared/remote/pairing.ts'
import { PROTOCOL_VERSION, type Socket } from '../../shared/remote/protocol.ts'

export const PAIR_TIMEOUT_MS = 10_000

export interface PairedHost { pub: string; machine: MachineInfo }

export interface PairClientDeps {
  dial: (address: string) => Socket
  ownPub: Uint8Array
  me: MachineInfo
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (h: unknown) => void
}

/** Resolves the verified host, or rejects; nothing is stored here (the caller trusts the result). */
export function pairWithHost(d: PairClientDeps, address: string, code: string): Promise<PairedHost> {
  const norm = normalizeCode(code)
  if (norm === null) return Promise.reject(new Error('código inválido'))
  const nonceC = randomBytes(NONCE_LEN)
  return new Promise((resolve, reject) => {
    let sock: Socket
    try { sock = d.dial(address) } catch (e) { return reject(e instanceof Error ? e : new Error(String(e))) }
    let done = false
    const finish = (err: Error | null, ok?: PairedHost): void => {
      if (done) return
      done = true
      d.clearTimeout(timer)
      try { sock.close() } catch { /* already closed */ }
      if (err) reject(err)
      else resolve(ok!)
    }
    const timer = d.setTimeout(() => finish(new Error('sem resposta')), PAIR_TIMEOUT_MS)
    sock.onClose(() => finish(new Error('conexão encerrada')))
    sock.onMessage(data => {
      if (typeof data !== 'string') return finish(new Error('resposta inválida'))
      const fail = parsePairFail(data)
      if (fail) return finish(new Error(fail.reason))
      const p = parsePaired(data)
      if (!p) return finish(new Error('resposta inválida'))
      const hpub = fromB64(p.hpub)
      if (!verifyHostProof(norm, hpub, d.ownPub, fromB64(p.nonceH), nonceC, p.proof)) {
        return finish(new Error('resposta do host não confere'))
      }
      finish(null, { pub: toB64(hpub), machine: { id: p.machineId, name: p.name, os: p.os } })
    })
    const msg: PairMsg = {
      t: 'pair', cpub: toB64(d.ownPub), nonceC: toB64(nonceC), proof: clientProof(norm, d.ownPub, nonceC),
      machineId: d.me.id, name: d.me.name, os: d.me.os, protocol: PROTOCOL_VERSION
    }
    try { sock.send(JSON.stringify(msg)) } catch { finish(new Error('conexão encerrada')) }
  })
}
