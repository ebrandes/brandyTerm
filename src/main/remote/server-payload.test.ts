import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HANDSHAKE_MAX } from './ws-keepalive.ts'
import { withHost } from './server-rig.ts'

test('before the handshake a message is capped at a few KB: a bigger one closes the socket', () => withHost(async e => {
  assert.ok(HANDSHAKE_MAX <= 16 * 1024)
  const ws = await e.raw()
  const code = await new Promise<number>(resolve => {
    ws.once('close', c => resolve(c))
    ws.send('x'.repeat(HANDSHAKE_MAX + 1))
  })
  assert.equal(code, 1009, 'message too big')
}))

test('a handshake-sized first message still gets through (pairing reply)', () => withHost(async e => {
  const ws = await e.raw()
  const reply = await new Promise<string>(resolve => {
    ws.once('message', d => resolve(d.toString('utf8')))
    ws.send(JSON.stringify({ t: 'pair', pad: 'x'.repeat(HANDSHAKE_MAX - 100) }))
  })
  assert.match(reply, /pair-fail/)
  ws.close()
}))

test('once the device is authenticated, large requests work again', () => withHost(async e => {
  e.reg.add('attach:save', a => (a as { data: string }).data.length, 'pass')
  const ch = await e.connect()
  const big = 'y'.repeat(2 * 1024 * 1024)
  assert.equal(await ch.request('attach:save', { projectId: 'a', data: big }), big.length)
  ch.close()
}))
