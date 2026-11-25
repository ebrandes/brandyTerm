import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVariants } from './variants.ts'
import { portUrl } from './port-url.ts'
import { onRemoteFolderRequest } from './folder-picker-bus.ts'
import type { BrandyApi } from '../../../shared/api.ts'
import type { RemoteHostInfo } from '../../../shared/remote/machine.ts'

function fake(hosts: RemoteHostInfo[]) {
  const log: unknown[] = []
  const local = {
    openFolder: async () => { log.push('local-folder'); return 'lp' },
    openAttachment: async (p: string) => { log.push(['local-att', p]) },
    openArtifact: async (a: unknown) => { log.push(['local-art', a]) },
    openPort: async (p: number) => { log.push(['local-port', p]) },
    remote: {
      hosts: async () => hosts,
      call: async (c: unknown) => { log.push(['call', c]); return { name: 'f.png', mime: 'image/png', data: new Uint8Array([1]) } },
      openBytes: async (a: unknown) => { log.push(['bytes', a]) }
    }
  } as unknown as BrandyApi
  const opened: string[] = []
  return { v: createVariants(local, u => opened.push(u)), log, opened }
}
const host = (over: Partial<RemoteHostInfo> = {}): RemoteHostInfo => ({ machine: { id: 'm1', name: 'Mac do Bob', os: 'mac' }, online: true, address: '192.168.0.9:7777', ...over })

test('portUrl takes the host part of ip:port', () => {
  assert.equal(portUrl('192.168.0.9:7777', 3000), 'http://192.168.0.9:3000')
  assert.equal(portUrl('[fe80::1]:7777', 3000), 'http://[fe80::1]:3000')
  assert.equal(portUrl(undefined, 3000), null)
  for (const bad of ['1@evil.com', '0', 70000, 1.5, -1, NaN]) assert.equal(portUrl('192.168.0.9:7777', bad as never), null, String(bad))
})

test('openPort: local project opens localhost via main; remote opens the host ip', async () => {
  const f = fake([host()])
  await f.v.openPort(3000, 'p1')
  assert.deepEqual(f.log, [['local-port', 3000]])
  await f.v.openPort(3000, '@m1/p1')
  assert.deepEqual(f.opened, ['http://192.168.0.9:3000'])
})

test('openPort on an offline or addressless host rejects with the name', async () => {
  await assert.rejects(fake([host({ online: false })]).v.openPort(1, '@m1/p'), /Mac do Bob está offline/)
  await assert.rejects(fake([host({ address: undefined })]).v.openPort(1, '@m1/p'), /Mac do Bob está offline/)
})

test('openAttachment and openArtifact on a remote project read on the host, then open here', async () => {
  const f = fake([host()])
  await f.v.openAttachment('/h/att/p/a.png', '@m1/p')
  await f.v.openArtifact({ projectId: '@m1/p', path: 'a.md' })
  assert.deepEqual(f.log, [
    ['call', { machineId: 'm1', channel: 'attach:read', arg: { projectId: 'p', path: '/h/att/p/a.png' } }],
    ['bytes', { machineId: 'm1', name: 'f.png', data: new Uint8Array([1]) }],
    ['call', { machineId: 'm1', channel: 'artifact:bytes', arg: { projectId: 'p', path: 'a.md' } }],
    ['bytes', { machineId: 'm1', name: 'f.png', data: new Uint8Array([1]) }]
  ])
  await f.v.openAttachment('/local/a.png', 'p')
  assert.deepEqual(f.log.slice(4), [['local-att', '/local/a.png']])
})

test('openFolder: no machine uses the local dialog; a machine asks the picker', async () => {
  const f = fake([host()])
  assert.equal(await f.v.openFolder(), 'lp')
  assert.equal(await f.v.openFolder('m1'), null) // no picker mounted
  const off = onRemoteFolderRequest(r => r.resolve(`@${r.machineId}/new`))
  assert.equal(await f.v.openFolder('m1'), '@m1/new')
  off()
})
