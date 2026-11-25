import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { WebSocket } from 'ws'
import { parseAddress } from './ws-dial.ts'
import { keepAlive, PING_MS, PONG_MS, type KeepTimers } from './ws-keepalive.ts'
import { wsSocket } from './ws-socket.ts'

class FakeWs extends EventEmitter {
  readonly OPEN = 1
  readyState = 1
  pings = 0
  ping(): void { this.pings++ }
  terminate(): void { this.readyState = 3; this.emit('close') }
  close(): void { this.terminate() }
}

function timers() {
  const items: { id: number; fn: () => void; ms: number }[] = []
  let n = 0
  const t: KeepTimers = {
    set: (fn, ms) => { items.push({ id: ++n, fn, ms }); return n },
    clear: h => { const i = items.findIndex(x => x.id === h); if (i >= 0) items.splice(i, 1) }
  }
  return { t, items }
}

test('a silent peer is terminated after ping + pong window, and the socket reports closed', () => {
  const ws = new FakeWs()
  const { t, items } = timers()
  const sock = wsSocket(ws as unknown as WebSocket)
  let closed = false
  sock.onClose(() => { closed = true })
  keepAlive(ws as unknown as WebSocket, t)
  assert.equal(items[0].ms, PING_MS)
  items.shift()!.fn()
  assert.equal(ws.pings, 1)
  assert.equal(items[0].ms, PONG_MS)
  items.shift()!.fn() // no pong
  assert.equal(closed, true)
  assert.equal(items.length, 0)
})

test('a pong keeps the connection and schedules the next ping', () => {
  const ws = new FakeWs()
  const { t, items } = timers()
  keepAlive(ws as unknown as WebSocket, t)
  items.shift()!.fn()
  ws.emit('pong')
  assert.equal(items.length, 1)
  assert.equal(items[0].ms, PING_MS)
  assert.equal(ws.readyState, 1)
  ws.emit('close')
  assert.equal(items.length, 0)
})

test('parseAddress accepts only a private ip:port', () => {
  assert.equal(parseAddress('192.168.1.5:7777'), '192.168.1.5:7777')
  for (const a of ['example.com:80', '8.8.8.8:80', '100.64.0.1:80', '10.0.0.1', '10.0.0.1:0', '10.0.0.1:70000']) {
    assert.equal(parseAddress(a), null, a)
  }
})
