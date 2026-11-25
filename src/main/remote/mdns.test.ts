import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lanOnlyRecords } from './mdns.ts'

test('lanOnlyRecords drops tunnel addresses and keeps service records', () => {
  const recs = [
    { name: 'x._brandyterm._tcp.local', type: 'SRV' },
    { name: 'h', type: 'A', data: '10.8.0.2' },
    { name: 'h', type: 'AAAA', data: 'fe80::1' }
  ]
  const out = lanOnlyRecords(recs, 'h', ['192.168.1.20'])
  assert.deepEqual(out.map(r => [r.type, r.data]), [['SRV', undefined], ['A', '192.168.1.20']])
})
