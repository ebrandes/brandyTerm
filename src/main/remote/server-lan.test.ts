import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { withHost } from './server-rig.ts'

/** Opens a plain TCP socket, optionally sends `text`, and reports what came back before the host closed it. */
function probe(port: number, text?: string): Promise<{ bytes: number; closedMs: number }> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now()
    let bytes = 0
    const s = net.connect(port, '127.0.0.1', () => { if (text) s.write(text) })
    s.on('data', d => { bytes += d.length })
    s.on('error', () => { /* reset by the host: same as a close */ })
    s.on('close', () => resolve({ bytes, closedMs: performance.now() - t0 }))
    setTimeout(() => { s.destroy(); reject(new Error('the host kept the socket open')) }, 2000).unref()
  })
}

test('a connection that did not come in on the LAN is cut before any HTTP: no bytes back', async () => {
  const seen: [string, string][] = []
  await withHost(async e => {
    const silent = await probe(e.host.port())
    assert.equal(silent.bytes, 0)
    assert.ok(silent.closedMs < 1000, 'cut on connect, not after an HTTP timeout')
    const http = await probe(e.host.port(), 'GET / HTTP/1.1\r\nHost: x\r\n\r\n')
    assert.equal(http.bytes, 0, 'not even a 404')
    await assert.rejects(e.raw())
  }, { acceptAddress: (local, remote) => { seen.push([local, remote]); return false } })
  assert.ok(seen.length >= 3)
  assert.match(seen[0][0], /127\.0\.0\.1$/)
  assert.match(seen[0][1], /127\.0\.0\.1$/)
})

test('a LAN connection is let through to the WebSocket handshake', () => withHost(async e => {
  const ch = await e.connect()
  assert.equal(await ch.request('chat:send', { projectId: 'a' }), 'sent:a')
  ch.close()
}, { acceptAddress: () => true }))
