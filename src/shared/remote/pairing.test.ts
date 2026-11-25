import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newPairingCode, normalizeCode, clientProof, hostProof, verifyHostProof, proofEquals, PairingWindow, NONCE_LEN } from './pairing.ts'

const b = (n: number) => new Uint8Array(32).fill(n)
const nn = (n: number) => new Uint8Array(NONCE_LEN).fill(n)

test('newPairingCode format', () => {
  for (let i = 0; i < 50; i++) assert.match(newPairingCode(), /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/)
})

test('normalizeCode', () => {
  assert.equal(normalizeCode('abcd efgh-jkmn pqrs'), 'ABCDEFGHJKMNPQRS')
  assert.equal(normalizeCode('abc'), null)
  assert.equal(normalizeCode('O1IL' + '1'.repeat(12)), '0111' + '1'.repeat(12))
  assert.equal(normalizeCode('U'.repeat(16)), null)
})

test('PairingWindow: ok then closed', () => {
  const w = new PairingWindow(() => 0)
  const code = normalizeCode(w.open())!
  assert.equal(w.check(b(1), nn(2), clientProof(code, b(1), nn(2))), 'ok')
  assert.equal(w.check(b(1), nn(2), clientProof(code, b(1), nn(2))), 'closed')
})

test('PairingWindow: closes after 3 bad', () => {
  const w = new PairingWindow(() => 0)
  const code = normalizeCode(w.open())!
  for (let i = 0; i < 3; i++) assert.equal(w.check(b(1), nn(2), 'AAAA'), 'bad')
  assert.equal(w.check(b(1), nn(2), clientProof(code, b(1), nn(2))), 'closed')
})

test('PairingWindow: expires after 120s', () => {
  let t = 0
  const w = new PairingWindow(() => t)
  const code = normalizeCode(w.open())!
  t = 120_001
  assert.equal(w.check(b(1), nn(2), clientProof(code, b(1), nn(2))), 'closed')
})

test('PairingWindow: valid at the 120s boundary', () => {
  let t = 0
  const w = new PairingWindow(() => t)
  const code = normalizeCode(w.open())!
  t = 120_000
  assert.equal(w.check(b(1), nn(2), clientProof(code, b(1), nn(2))), 'ok')
})

test('hostProof differs with another code', () => {
  const a = hostProof('ABCDEFGHJKMNPQRS', b(1), b(2), nn(3), nn(4))
  assert.notEqual(a, hostProof('0123456789ABCDEF', b(1), b(2), nn(3), nn(4)))
  assert.notEqual(clientProof('ABCDEFGHJKMNPQRS', b(2), nn(3)), a)
})

test('check: well-formed proof under another code is bad', () => {
  const w = new PairingWindow(() => 0)
  w.open()
  assert.equal(w.check(b(1), nn(2), clientProof('0123456789ABCDEF', b(1), nn(2))), 'bad')
})

test('check: right code but proof for different cpub or nonceC is bad', () => {
  const w = new PairingWindow(() => 0)
  const code = normalizeCode(w.open())!
  assert.equal(w.check(b(1), nn(2), clientProof(code, b(9), nn(2))), 'bad')
  assert.equal(w.check(b(1), nn(2), clientProof(code, b(1), nn(9))), 'bad')
  assert.equal(w.check(b(1), nn(2), clientProof(code, b(1), nn(2))), 'ok')
})

test('check: wrong field lengths are bad even with a matching proof', () => {
  const w = new PairingWindow(() => 0)
  const code = normalizeCode(w.open())!
  const short = new Uint8Array(8).fill(2)
  assert.equal(w.check(b(1), short, clientProof(code, b(1), short)), 'bad')
  assert.equal(w.check(new Uint8Array(31), nn(2), clientProof(code, new Uint8Array(31), nn(2))), 'bad')
})

test('proofEquals', () => {
  const p = clientProof('ABCDEFGHJKMNPQRS', b(1), nn(2))
  assert.equal(proofEquals(p, p), true)
  const raw = Buffer.from(p, 'base64')
  raw[0] ^= 1
  assert.equal(proofEquals(p, raw.toString('base64')), false)
  assert.equal(proofEquals(p, Buffer.from(p, 'base64').subarray(0, 31).toString('base64')), false)
  assert.equal(proofEquals(p, '!!!not base64!!!'), false)
})

test('verifyHostProof', () => {
  const code = 'ABCDEFGHJKMNPQRS'
  const p = hostProof(code, b(1), b(2), nn(3), nn(4))
  assert.equal(verifyHostProof(code, b(1), b(2), nn(3), nn(4), p), true)
  assert.equal(verifyHostProof('0123456789ABCDEF', b(1), b(2), nn(3), nn(4), p), false)
  assert.equal(verifyHostProof(code, new Uint8Array(31), b(2), nn(3), nn(4), p), false)
})

test('proofs accept dashed code, reject invalid code', () => {
  assert.equal(
    hostProof('ABCD-EFGH-JKMN-PQRS', b(1), b(2), nn(3), nn(4)),
    hostProof('ABCDEFGHJKMNPQRS', b(1), b(2), nn(3), nn(4))
  )
  assert.throws(() => clientProof('short', b(1), nn(2)))
})
