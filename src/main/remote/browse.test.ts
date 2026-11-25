import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toDiscovered } from './browse.ts'

const txt = { id: 'm1', os: 'mac' }

test('toDiscovered keeps only a private IPv4 and formats ip:port', () => {
  const h = toDiscovered({ name: 'Mac', port: 7777, addresses: ['100.64.0.2', 'fe80::1', '192.168.1.20'], txt })
  assert.deepEqual(h, { name: 'Mac', os: 'mac', address: '192.168.1.20:7777', machineId: 'm1' })
})

test('toDiscovered refuses tunnel/public-only addresses and incomplete txt', () => {
  assert.equal(toDiscovered({ name: 'x', port: 1, addresses: ['100.64.0.2', '8.8.8.8'], txt }), null)
  assert.equal(toDiscovered({ name: 'x', port: 1, addresses: ['10.0.0.2'], txt: { os: 'mac' } }), null)
  assert.equal(toDiscovered({ name: 'x', port: 1, addresses: ['10.0.0.2'], txt: { id: 'a', os: 'beos' } }), null)
})
