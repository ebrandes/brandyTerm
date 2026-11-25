// Host side of the pairing exchange (see shared/remote/pair-wire.ts). No sockets: text in, text out.
import { randomBytes } from '@noble/hashes/utils'
import { fromB64, toB64 } from '../../shared/remote/crypto.ts'
import type { MachineInfo } from '../../shared/remote/machine.ts'
import { pairedMsg, parsePair, type PairFailReason } from '../../shared/remote/pair-wire.ts'
import { hostProof, NONCE_LEN, type PairingWindow } from '../../shared/remote/pairing.ts'
import { PROTOCOL_VERSION } from '../../shared/remote/protocol.ts'
import type { TrustStore } from './trust.ts'

export interface PairingCtx {
  window: PairingWindow
  /** code returned by window.open(); the window forgets it when it closes, but the proof still needs it */
  code: string | null
  trust: TrustStore
  machine: MachineInfo
}

const fail = (reason: PairFailReason): string => JSON.stringify({ t: 'pair-fail', reason })

/** Returns the reply to send; adds the client to the trust store on success. */
export function handlePair(text: string, ctx: PairingCtx): { reply: string; paired: boolean } {
  const msg = parsePair(text)
  if (!msg) {
    // fail closed: a malformed attempt still burns one of the window's tries
    const r = ctx.window.check(new Uint8Array(0), new Uint8Array(0), '')
    return { reply: fail(r === 'closed' ? 'pareamento fechado' : 'código inválido'), paired: false }
  }
  if (msg.protocol !== PROTOCOL_VERSION) return { reply: fail('versão diferente'), paired: false }
  const cpub = fromB64(msg.cpub)
  const nonceC = fromB64(msg.nonceC)
  const r = ctx.window.check(cpub, nonceC, msg.proof)
  if (r !== 'ok' || ctx.code === null) {
    return { reply: fail(r === 'closed' || ctx.code === null ? 'pareamento fechado' : 'código inválido'), paired: false }
  }
  ctx.trust.add({ pub: toB64(cpub), machineId: msg.machineId, name: msg.name, os: msg.os })
  const hpub = ctx.trust.ownKey().pub
  const nonceH = randomBytes(NONCE_LEN)
  const proof = hostProof(ctx.code, hpub, cpub, nonceH, nonceC)
  return { reply: JSON.stringify(pairedMsg(toB64(hpub), toB64(nonceH), proof, ctx.machine)), paired: true }
}
