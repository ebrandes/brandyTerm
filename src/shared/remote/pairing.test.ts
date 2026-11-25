import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newPairingCode, normalizeCode, clientProof, hostProof, PairingWindow } from './pairing.ts'

const b = (n: number) => new Uint8Array(32).fill(n)

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
  assert.equal(w.check(b(1), b(2), clientProof(code, b(1), b(2))), 'ok')
  assert.equal(w.check(b(1), b(2), clientProof(code, b(1), b(2))), 'closed')
})

test('PairingWindow: closes after 3 bad', () => {
  const w = new PairingWindow(() => 0)
  const code = normalizeCode(w.open())!
  for (let i = 0; i < 3; i++) assert.equal(w.check(b(1), b(2), 'AAAA'), 'bad')
  assert.equal(w.check(b(1), b(2), clientProof(code, b(1), b(2))), 'closed')
})

test('PairingWindow: expires after 120s', () => {
  let t = 0
  const w = new PairingWindow(() => t)
  const code = normalizeCode(w.open())!
  t = 120_001
  assert.equal(w.check(b(1), b(2), clientProof(code, b(1), b(2))), 'closed')
})

test('PairingWindow: valid at the 120s boundary', () => {
  let t = 0
  const w = new PairingWindow(() => t)
  const code = normalizeCode(w.open())!
  t = 120_000
  assert.equal(w.check(b(1), b(2), clientProof(code, b(1), b(2))), 'ok')
})

test('hostProof differs with another code', () => {
  const a = hostProof('ABCDEFGHJKMNPQRS', b(1), b(2), b(3), b(4))
  assert.notEqual(a, hostProof('0123456789ABCDEF', b(1), b(2), b(3), b(4)))
  assert.notEqual(clientProof('ABCDEFGHJKMNPQRS', b(2), b(3)), a)
})
