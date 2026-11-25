import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePair, parsePaired, parsePairFail } from './pair-wire.ts'
import { toB64 } from './crypto.ts'

const b = (n: number) => toB64(new Uint8Array(n).fill(7))
const pair = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ t: 'pair', cpub: b(32), nonceC: b(16), proof: b(32), machineId: 'm1', name: 'Mac', os: 'mac', protocol: 1, ...over })
const paired = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ t: 'paired', hpub: b(32), nonceH: b(16), proof: b(32), machineId: 'm2', name: 'PC', os: 'linux', ...over })

test('parsePair accepts a valid message, including phone', () => {
  assert.equal(parsePair(pair())?.name, 'Mac')
  assert.equal(parsePair(pair({ os: 'phone' }))?.os, 'phone')
})

test('parsePair rejects malformed input', () => {
  const bad: unknown[] = [
    'not json', '[]', '"x"', JSON.stringify({ t: 'x' }),
    pair({ cpub: b(31) }), pair({ cpub: 5 }), pair({ cpub: '***' }), pair({ nonceC: b(15) }),
    pair({ proof: 3 }), pair({ proof: '***' }),
    pair({ os: 'amiga' }), pair({ name: '' }), pair({ name: 'x'.repeat(65) }),
    pair({ machineId: '' }), pair({ machineId: 1 }), pair({ protocol: '1' })
  ]
  for (const t of bad) assert.equal(parsePair(t as string), null, String(t))
})

test('parsePaired is strict and rejects phone', () => {
  assert.equal(parsePaired(paired())?.machineId, 'm2')
  for (const t of [paired({ hpub: b(33) }), paired({ nonceH: b(8) }), paired({ os: 'phone' }), paired({ name: '' }), 'nope'])
    assert.equal(parsePaired(t), null, t)
})

test('parsePairFail accepts known reasons only', () => {
  assert.equal(parsePairFail(JSON.stringify({ t: 'pair-fail', reason: 'pareamento fechado' }))?.reason, 'pareamento fechado')
  assert.equal(parsePairFail(JSON.stringify({ t: 'pair-fail', reason: 'outra' })), null)
  assert.equal(parsePairFail('{'), null)
})
