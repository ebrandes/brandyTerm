import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lanOnlyRecords, mdnsOptions } from './mdns.ts'

test('lanOnlyRecords drops tunnel addresses and keeps service records', () => {
  const recs = [
    { name: 'x._brandyterm._tcp.local', type: 'SRV' },
    { name: 'h', type: 'A', data: '10.8.0.2' },
    { name: 'h', type: 'AAAA', data: 'fe80::1' }
  ]
  const out = lanOnlyRecords(recs, 'h', ['192.168.1.20'])
  assert.deepEqual(out.map(r => [r.type, r.data]), [['SRV', undefined], ['A', '192.168.1.20']])
})

test('mdnsOptions: no LAN address, no mDNS socket; otherwise only the LAN interface joins the group', () => {
  assert.equal(mdnsOptions([]), null)
  assert.deepEqual(mdnsOptions(['192.168.1.20', '10.0.0.3']), { interface: '192.168.1.20', bind: '0.0.0.0' })
})
