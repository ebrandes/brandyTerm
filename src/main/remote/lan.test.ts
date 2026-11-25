import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lanAddresses, isPrivateIPv4, acceptLan } from './lan.ts'

const v4 = (address: string, internal = false) =>
  ({ address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: `${address}/24` }) as const
const v6 = { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '00:00:00:00:00:00', internal: false, cidr: 'fe80::1/64', scopeid: 1 } as const

test('lanAddresses keeps private LAN interfaces only', () => {
  const ifaces = {
    en0: [v4('192.168.1.20'), v6],
    Ethernet: [v4('10.0.0.5')],
    wlan0: [v4('172.20.1.2')],
    utun3: [v4('10.8.0.2')],
    ppp0: [v4('192.168.2.1')],
    lo0: [v4('127.0.0.1', true)],
    en1: [v4('8.8.8.8')],
    en2: [v4('192.168.9.9', true)],
    ipsec0: [v4('10.9.0.2')],
    fortissl0: [v4('10.10.0.2')]
  }
  assert.deepEqual(lanAddresses(ifaces as never), ['192.168.1.20', '10.0.0.5', '172.20.1.2'])
})

test('isPrivateIPv4', () => {
  for (const a of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1']) assert.equal(isPrivateIPv4(a), true, a)
  for (const a of ['172.32.0.1', '8.8.8.8', '127.0.0.1', '169.254.1.1', '::1', '10.0.0', '999.1.1.1']) assert.equal(isPrivateIPv4(a), false, a)
})

test('acceptLan', () => {
  const ifaces = { en0: [v4('192.168.1.20')], utun3: [v4('10.8.0.2')], lo0: [v4('127.0.0.1', true)] } as never
  assert.equal(acceptLan(ifaces, '192.168.1.20', '192.168.1.50'), true)
  assert.equal(acceptLan(ifaces, '::ffff:192.168.1.20', '::ffff:192.168.1.50'), true)
  assert.equal(acceptLan(ifaces, '10.8.0.2', '192.168.1.50'), false)
  assert.equal(acceptLan(ifaces, '192.168.1.20', '8.8.8.8'), false)
  assert.equal(acceptLan(ifaces, '127.0.0.1', '127.0.0.1'), false)
  assert.equal(acceptLan(ifaces, '192.168.1.20', undefined), false)
})

test('a Fortinet adapter is not the LAN, whatever its name (Windows descriptions)', () => {
  const ifaces = { Ethernet: [v4('192.168.1.20')], 'Ethernet 3': [v4('10.212.134.5')] } as never
  const descriptions = { Ethernet: 'Intel(R) Ethernet Connection', 'Ethernet 3': 'Fortinet SSL VPN Virtual Ethernet Adapter' }
  assert.deepEqual(lanAddresses(ifaces, descriptions), ['192.168.1.20'])
  assert.deepEqual(lanAddresses(ifaces), ['192.168.1.20', '10.212.134.5'])
  assert.equal(acceptLan(ifaces, '10.212.134.5', '10.212.134.1', descriptions), false)
  assert.equal(acceptLan(ifaces, '::ffff:192.168.1.20', '192.168.1.9', descriptions), true)
})
