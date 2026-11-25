import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newKeyPair, initiatorStart, responderReply, initiatorFinish, FrameCipher } from './crypto.ts'
import type { SessionKeys } from './crypto.ts'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)

function handshake() {
  const si = newKeyPair()
  const sr = newKeyPair()
  const { msg, e } = initiatorStart(si)
  const r = responderReply(sr, msg, () => true)
  assert.ok(r)
  const ik = initiatorFinish(si, e, sr.pub, r.msg)
  return { si, sr, ik, rk: r.keys }
}

test('handshake derives mirrored session keys', () => {
  const { ik, rk } = handshake()
  assert.deepEqual(ik.send, rk.recv)
  assert.deepEqual(ik.recv, rk.send)
  assert.equal(ik.send.length, 32)
  assert.notDeepEqual(ik.send, ik.recv)
})

test('responderReply returns null for untrusted initiator', () => {
  const { msg } = initiatorStart(newKeyPair())
  assert.equal(responderReply(newKeyPair(), msg, () => false), null)
})

test('wrong responder static yields keys that cannot open frames', () => {
  const si = newKeyPair()
  const sr = newKeyPair()
  const { msg, e } = initiatorStart(si)
  const r = responderReply(sr, msg, () => true)!
  const ik = initiatorFinish(si, e, newKeyPair().pub, r.msg)
  const frame = new FrameCipher(r.keys).seal(enc('hi'))
  assert.throws(() => new FrameCipher(ik).open(frame))
})

function pair(): [FrameCipher, FrameCipher] {
  const { ik, rk } = handshake()
  return [new FrameCipher(ik), new FrameCipher(rk)]
}

test('seal/open round trip of 3 frames in order', () => {
  const [a, b] = pair()
  for (const t of ['um', 'dois', 'tres']) assert.equal(dec(b.open(a.seal(enc(t)))), t)
})

test('tampered frame throws', () => {
  const [a, b] = pair()
  const f = a.seal(enc('segredo'))
  f[f.length - 1] ^= 1
  assert.throws(() => b.open(f))
})

test('replay throws', () => {
  const [a, b] = pair()
  const f0 = a.seal(enc('0'))
  const f1 = a.seal(enc('1'))
  b.open(f0)
  b.open(f1)
  assert.throws(() => b.open(f1))
})

test('reorder throws', () => {
  const [a, b] = pair()
  a.seal(enc('0'))
  const f1 = a.seal(enc('1'))
  assert.throws(() => b.open(f1))
})

test('cipher fails closed after a failure', () => {
  const [a, b] = pair()
  const f0 = a.seal(enc('0'))
  const bad = f0.slice()
  bad[bad.length - 1] ^= 1
  assert.throws(() => b.open(bad))
  assert.throws(() => b.open(f0))
})

test('keys type is exported', () => {
  const k: SessionKeys | null = null
  assert.equal(k, null)
})
