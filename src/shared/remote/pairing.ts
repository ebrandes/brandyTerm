// Pairing codes and proofs. Pure: runs in Node and in browsers.
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha256'
import { randomBytes } from '@noble/hashes/utils'
import { toB64, fromB64 } from './crypto.ts'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_LEN = 16
const WINDOW_MS = 120_000
const MAX_BAD = 3
const PUB_LEN = 32
export const NONCE_LEN = 16
const utf8 = (s: string) => new TextEncoder().encode(s)

export function newCodeFrom(bytes: Uint8Array): string {
  // 32 symbols = 5 bits each: take bits straight from random bytes, no modulo bias.
  let acc = 0
  let bits = 0
  let out = ''
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5 && out.length < CODE_LEN) {
      bits -= 5
      out += ALPHABET[(acc >> bits) & 31]
    }
    acc &= (1 << bits) - 1
  }
  return out
}

export function newPairingCode(): string {
  const raw = newCodeFrom(randomBytes(10))
  return raw.match(/.{4}/g)!.join('-')
}

export function normalizeCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (s.length !== CODE_LEN) return null
  for (const c of s) if (!ALPHABET.includes(c)) return null
  return s
}

function mac(code: string, label: string, parts: Uint8Array[]): Uint8Array {
  const norm = normalizeCode(code)
  if (norm === null) throw new Error('invalid pairing code')
  const msg = utf8(label)
  const full = new Uint8Array(msg.length + parts.reduce((n, p) => n + p.length, 0))
  full.set(msg)
  let o = msg.length
  for (const p of parts) { full.set(p, o); o += p.length }
  return hmac(sha256, utf8(norm), full)
}

export function clientProof(code: string, cpub: Uint8Array, nonceC: Uint8Array): string {
  return toB64(mac(code, 'pair-c', [cpub, nonceC]))
}

export function hostProof(
  code: string, hpub: Uint8Array, cpub: Uint8Array, nonceH: Uint8Array, nonceC: Uint8Array
): string {
  return toB64(mac(code, 'pair-h', [hpub, cpub, nonceH, nonceC]))
}

export function verifyHostProof(
  code: string, hpub: Uint8Array, cpub: Uint8Array, nonceH: Uint8Array, nonceC: Uint8Array, proof: string
): boolean {
  if (hpub.length !== PUB_LEN || cpub.length !== PUB_LEN) return false
  if (nonceH.length !== NONCE_LEN || nonceC.length !== NONCE_LEN) return false
  return proofEquals(hostProof(code, hpub, cpub, nonceH, nonceC), proof)
}

export function proofEquals(a: string, b: string): boolean {
  let x: Uint8Array, y: Uint8Array
  try { x = fromB64(a); y = fromB64(b) } catch { return false }
  let diff = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

export class PairingWindow {
  private code: string | null = null
  private openedAt = 0
  private bad = 0
  private readonly now: () => number
  constructor(nowMs: () => number) { this.now = nowMs }

  open(): string {
    this.code = newPairingCode()
    this.openedAt = this.now()
    this.bad = 0
    return this.code
  }

  check(cpub: Uint8Array, nonceC: Uint8Array, proof: string): 'ok' | 'bad' | 'closed' {
    if (this.code === null) return 'closed'
    if (this.now() - this.openedAt > WINDOW_MS) { this.close(); return 'closed' }
    const wellFormed = cpub.length === PUB_LEN && nonceC.length === NONCE_LEN
    if (wellFormed && proofEquals(clientProof(this.code, cpub, nonceC), proof)) { this.close(); return 'ok' }
    if (++this.bad >= MAX_BAD) this.close()
    return 'bad'
  }

  close(): void { this.code = null }
}
