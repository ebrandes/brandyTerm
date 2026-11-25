import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BrandyApi } from '../../../shared/api.ts'
import { hostBlob, hostRead, hostView } from './host-file.ts'

test('hostView: media and pages of a remote project only', () => {
  assert.equal(hostView('@m1/p', 'image'), 'media')
  assert.equal(hostView('@m1/p', 'video'), 'media')
  assert.equal(hostView('@m1/p', 'html'), 'page')
  assert.equal(hostView('@m1/p', 'svg'), 'page')
  assert.equal(hostView('@m1/p', 'md'), null)
  assert.equal(hostView('p', 'image'), null)
  assert.equal(hostView('p', 'html'), null)
})

test('hostRead sends the call to the owning machine with its own project id', () => {
  assert.deepEqual(hostRead('artifact:bytes', '@m1/p', 'img/a.png'), {
    machineId: 'm1', channel: 'artifact:bytes', arg: { projectId: 'p', path: 'img/a.png' }
  })
  assert.deepEqual(hostRead('attach:read', '@m1/p', '/h/att/p/a.png'), {
    machineId: 'm1', channel: 'attach:read', arg: { projectId: 'p', path: '/h/att/p/a.png' }
  })
  assert.equal(hostRead('artifact:bytes', 'p', 'a.png'), null)
})

test('hostBlob reads on the host and builds a Blob of the file type', async () => {
  const calls: unknown[] = []
  const api = {
    remote: { call: async (c: unknown) => { calls.push(c); return { name: 'a.png', mime: 'image/png', data: new Uint8Array([1, 2, 3]) } } }
  } as unknown as BrandyApi
  const read = hostRead('artifact:bytes', '@m1/p', 'a.png')!
  let blob: Blob | null = null
  const url = await hostBlob(api, read, b => { blob = b; return 'blob:x' })
  assert.equal(url, 'blob:x')
  assert.deepEqual(calls, [read])
  assert.equal(blob!.type, 'image/png')
  assert.deepEqual([...new Uint8Array(await blob!.arrayBuffer())], [1, 2, 3])
})
