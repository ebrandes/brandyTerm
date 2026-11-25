// Handshake + frame encryption for paired devices. Pure: runs in Node and in browsers.
import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { randomBytes } from '@noble/hashes/utils'
import { xchacha20poly1305 } from '@noble/ciphers/chacha'

export interface KeyPair { pub: Uint8Array; priv: Uint8Array }
export interface Hello1 { ie: string; is: string }
export interface Hello2 { re: string }
export interface SessionKeys { send: Uint8Array; recv: Uint8Array }

const PROTOCOL = 'brandyterm-kk-v1'
const utf8 = (s: string) => new TextEncoder().encode(s)

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

export function toB64(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s)
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function newKeyPair(): KeyPair {
  const priv = randomBytes(32)
  return { priv, pub: x25519.getPublicKey(priv) }
}

export function initiatorStart(s: KeyPair): { msg: Hello1; e: KeyPair } {
  const e = newKeyPair()
  return { msg: { ie: toB64(e.pub), is: toB64(s.pub) }, e }
}

function schedule(
  ee: Uint8Array, es: Uint8Array, se: Uint8Array, ss: Uint8Array,
  ie: Uint8Array, is: Uint8Array, re: Uint8Array, rs: Uint8Array
): Uint8Array {
  const salt = sha256(concat(utf8(PROTOCOL), ie, is, re, rs))
  return hkdf(sha256, concat(ee, es, se, ss), salt, utf8('keys'), 64)
}

export function responderReply(
  s: KeyPair, m: Hello1, trusted: (pub: Uint8Array) => boolean
): { msg: Hello2; keys: SessionKeys } | null {
  const ie = fromB64(m.ie)
  const is = fromB64(m.is)
  if (ie.length !== 32 || is.length !== 32 || !trusted(is)) return null
  const e = newKeyPair()
  const okm = schedule(
    x25519.getSharedSecret(e.priv, ie), // ee
    x25519.getSharedSecret(s.priv, ie), // es: e_I * s_R
    x25519.getSharedSecret(e.priv, is), // se: s_I * e_R
    x25519.getSharedSecret(s.priv, is), // ss
    ie, is, e.pub, s.pub
  )
  return { msg: { re: toB64(e.pub) }, keys: { send: okm.slice(32, 64), recv: okm.slice(0, 32) } }
}

export function initiatorFinish(s: KeyPair, e: KeyPair, rs: Uint8Array, m: Hello2): SessionKeys {
  const re = fromB64(m.re)
  if (re.length !== 32) throw new Error('bad responder ephemeral key')
  const okm = schedule(
    x25519.getSharedSecret(e.priv, re),
    x25519.getSharedSecret(e.priv, rs),
    x25519.getSharedSecret(s.priv, re),
    x25519.getSharedSecret(s.priv, rs),
    e.pub, s.pub, re, rs
  )
  return { send: okm.slice(0, 32), recv: okm.slice(32, 64) }
}

function nonceFor(counter: Uint8Array): Uint8Array {
  const n = new Uint8Array(24)
  n.set(counter, 16)
  return n
}

export class FrameCipher {
  private sendCtr = 0n
  private recvCtr = 0n
  private dead = false
  private readonly k: SessionKeys
  constructor(k: SessionKeys) { this.k = k }

  seal(plain: Uint8Array): Uint8Array {
    const ctr = new Uint8Array(8)
    new DataView(ctr.buffer).setBigUint64(0, this.sendCtr)
    this.sendCtr++
    return concat(ctr, xchacha20poly1305(this.k.send, nonceFor(ctr)).encrypt(plain))
  }

  open(sealed: Uint8Array): Uint8Array {
    if (this.dead) throw new Error('channel closed after failure')
    try {
      if (sealed.length < 8 + 16) throw new Error('frame too short')
      const ctr = sealed.subarray(0, 8)
      if (new DataView(sealed.buffer, sealed.byteOffset, sealed.byteLength).getBigUint64(0) !== this.recvCtr) throw new Error('unexpected frame counter')
      const plain = xchacha20poly1305(this.k.recv, nonceFor(ctr)).decrypt(sealed.subarray(8))
      this.recvCtr++
      return plain
    } catch (err) {
      this.dead = true
      throw err
    }
  }
}
