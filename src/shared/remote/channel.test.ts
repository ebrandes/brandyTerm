import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptChannel, connectChannel, type SecureChannel } from './channel.ts'
import {
  FrameCipher, initiatorFinish, initiatorStart, newKeyPair, responderReply, toB64
} from './crypto.ts'
import type { MachineInfo } from './machine.ts'
import { decodeFrame, type Frame, type Socket } from './protocol.ts'

type Data = Uint8Array | string

class End implements Socket {
  peer!: End
  closed = false
  private cb: ((d: Data) => void) | null = null
  private closeCb: (() => void) | null = null
  private queue: Data[] = []
  private readonly wrap: (d: Data) => Data
  constructor(wrap: (d: Data) => Data) { this.wrap = wrap }
  send(data: Data): void {
    if (this.closed) return
    const d = this.wrap(data)
    queueMicrotask(() => this.peer.deliver(d))
  }
  deliver(d: Data): void {
    if (this.closed) return
    if (this.cb) this.cb(d)
    else this.queue.push(d)
  }
  onMessage(cb: (d: Data) => void): void {
    this.cb = cb
    for (const d of this.queue.splice(0)) cb(d)
  }
  onClose(cb: () => void): void { this.closeCb = cb }
  close(): void {
    if (this.closed) return
    this.closed = true
    this.closeCb?.()
    queueMicrotask(() => this.peer.close())
  }
}

const identity = (d: Data): Data => d
// Delivers binary frames as Node Buffers that are views into a larger ArrayBuffer (nonzero byteOffset).
function asBufferView(d: Data): Data {
  if (typeof d === 'string') return d
  const ab = new ArrayBuffer(d.length + 13)
  new Uint8Array(ab).set(d, 7)
  return Buffer.from(ab, 7, d.length)
}

function pair(wrap: (d: Data) => Data = identity): [End, End] {
  const a = new End(wrap)
  const b = new End(wrap)
  a.peer = b
  b.peer = a
  return [a, b]
}

const clientInfo: MachineInfo = { id: 'c', name: 'Cliente', os: 'mac' }
const serverInfo: MachineInfo = { id: 's', name: 'Servidor', os: 'linux' }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function connected(wrap?: (d: Data) => Data): Promise<{ client: SecureChannel; server: SecureChannel }> {
  const [a, b] = pair(wrap)
  const ck = newKeyPair()
  const sk = newKeyPair()
  const [client, server] = await Promise.all([
    connectChannel(a, ck, sk.pub, clientInfo),
    acceptChannel(b, sk, () => true, serverInfo)
  ])
  return { client, server }
}

test('connect and accept succeed, each side sees the other machine', async () => {
  const [a, b] = pair()
  const ck = newKeyPair()
  const sk = newKeyPair()
  const [client, server] = await Promise.all([
    connectChannel(a, ck, sk.pub, clientInfo),
    acceptChannel(b, sk, () => true, serverInfo)
  ])
  assert.deepEqual(client.peer, serverInfo)
  assert.deepEqual(server.peer, clientInfo)
  assert.equal(client.peerPub, toB64(sk.pub))
  assert.equal(server.peerPub, toB64(ck.pub))
  client.close()
})

test('request resolves with handler value; handler error message becomes rejection', async () => {
  const { client, server } = await connected()
  const seen: unknown[] = []
  server.serve(async (ch, arg) => {
    seen.push([ch, arg])
    if (ch === 'fail') throw new Error('boom')
    return 2
  })
  assert.equal(await client.request('x', 1), 2)
  assert.deepEqual(seen, [['x', 1]])
  await assert.rejects(client.request('fail', null), { message: 'boom' })
  client.close()
})

test('request without a serve handler errors with "sem handler"', async () => {
  const { client } = await connected()
  await assert.rejects(client.request('x', 1), { message: 'sem handler' })
  client.close()
})

test('push from server reaches client onPush', async () => {
  const { client, server } = await connected()
  const got = new Promise<unknown>(res => client.onPush((t, p) => res([t, p])))
  server.push('state', { a: 1 })
  assert.deepEqual(await got, ['state', { a: 1 }])
  client.close()
})

test('works when frames arrive as Node Buffer views with nonzero byteOffset', async () => {
  const { client, server } = await connected(asBufferView)
  server.serve(async (_c, arg) => (arg as number) + 1)
  assert.equal(await client.request('inc', 41), 42)
  const got = new Promise<unknown>(res => client.onPush((_t, p) => res(p)))
  server.push('t', 'ok')
  assert.equal(await got, 'ok')
  client.close()
})

test('untrusted client: accept rejects and connect rejects', async () => {
  const [a, b] = pair()
  const ck = newKeyPair()
  const sk = newKeyPair()
  const [c, s] = await Promise.allSettled([
    connectChannel(a, ck, sk.pub, clientInfo),
    acceptChannel(b, sk, () => false, serverInfo)
  ])
  assert.equal(c.status, 'rejected')
  assert.equal(s.status, 'rejected')
  assert.ok(a.closed && b.closed)
})

test('malformed handshake input (bad base64) rejects acceptChannel and closes the socket', async () => {
  const [a, b] = pair()
  const p = acceptChannel(b, newKeyPair(), () => true, serverInfo)
  a.send(JSON.stringify({ ie: '!!!', is: '!!!' }))
  await assert.rejects(p)
  assert.ok(b.closed)
})

test('binary data before the handshake completes closes the channel', async () => {
  const [a, b] = pair()
  const p = acceptChannel(b, newKeyPair(), () => true, serverInfo)
  a.send(new Uint8Array([1, 2, 3]))
  await assert.rejects(p)
  assert.ok(b.closed)
})

test('trusted key without its private key fails at the first frame (key confirmation)', async () => {
  const [a, b] = pair()
  const victim = newKeyPair()
  const sk = newKeyPair()
  const p = acceptChannel(b, sk, pub => toB64(pub) === toB64(victim.pub), serverInfo)
  const { msg } = initiatorStart(victim)
  a.send(JSON.stringify({ ie: msg.ie, is: msg.is }))
  a.send(new Uint8Array(64).fill(7))
  await assert.rejects(p, { message: 'quadro inválido' })
  assert.ok(b.closed)
})

// A raw peer that speaks the handshake by hand so it can send arbitrary hello frames.
function helloBytes(cipher: FrameCipher, protocol: number, machine: MachineInfo): Uint8Array {
  const f: Frame = { k: 'hello', protocol, machine }
  return cipher.seal(new TextEncoder().encode(JSON.stringify(f)))
}

test('peer hello with protocol 2 makes accept side close with "versão diferente"', async () => {
  const [a, b] = pair()
  const sk = newKeyPair()
  const raw = newKeyPair()
  const p = acceptChannel(b, sk, () => true, serverInfo)
  const { msg, e } = initiatorStart(raw)
  a.onMessage(d => {
    if (typeof d !== 'string') return
    const keys = initiatorFinish(raw, e, sk.pub, JSON.parse(d))
    a.send(helloBytes(new FrameCipher(keys), 2, clientInfo))
  })
  a.send(JSON.stringify(msg))
  await assert.rejects(p, { message: 'versão diferente' })
  await sleep(5)
  assert.ok(a.closed && b.closed)
})

test('peer hello with protocol 2 makes connect side close with "versão diferente"', async () => {
  const [a, b] = pair()
  const sk = newKeyPair()
  const p = connectChannel(a, newKeyPair(), sk.pub, clientInfo)
  b.onMessage(d => {
    if (typeof d !== 'string') return
    const r = responderReply(sk, JSON.parse(d), () => true)!
    b.send(JSON.stringify(r.msg))
    b.send(helloBytes(new FrameCipher(r.keys), 2, serverInfo))
  })
  await assert.rejects(p, { message: 'versão diferente' })
  await sleep(5)
  assert.ok(a.closed && b.closed)
})

test('pending request rejects with "Máquina desconectada" when the socket closes', async () => {
  const [a, b] = pair()
  const ck = newKeyPair()
  const sk = newKeyPair()
  const [client, server] = await Promise.all([
    connectChannel(a, ck, sk.pub, clientInfo),
    acceptChannel(b, sk, () => true, serverInfo)
  ])
  server.serve(() => new Promise(() => {}))
  const reasons: string[] = []
  client.onClose(r => reasons.push(r))
  const req = client.request('x', 1)
  await sleep(5)
  b.close()
  await assert.rejects(req, { message: 'Máquina desconectada' })
  assert.equal(reasons.length, 1)
  await assert.rejects(client.request('y', 1), { message: 'Máquina desconectada' })
})

test('tampered frame closes the channel with "quadro inválido"', async () => {
  const [a, b] = pair()
  const ck = newKeyPair()
  const sk = newKeyPair()
  const [client, server] = await Promise.all([
    connectChannel(a, ck, sk.pub, clientInfo),
    acceptChannel(b, sk, () => true, serverInfo)
  ])
  const reasons: string[] = []
  server.onClose(r => reasons.push(r))
  a.send(new Uint8Array(40).fill(9))
  await sleep(5)
  assert.deepEqual(reasons, ['quadro inválido'])
  await assert.rejects(client.request('x', 1), { message: 'Máquina desconectada' })
})

test('text frame after the handshake closes the channel', async () => {
  const [a, b] = pair()
  const sk = newKeyPair()
  const [, server] = await Promise.all([
    connectChannel(a, newKeyPair(), sk.pub, clientInfo),
    acceptChannel(b, sk, () => true, serverInfo)
  ])
  const reasons: string[] = []
  server.onClose(r => reasons.push(r))
  a.send('{"k":"push","topic":"t"}')
  await sleep(5)
  assert.deepEqual(reasons, ['quadro inválido'])
})

test('response for an unknown id is ignored', async () => {
  const [a, b] = pair()
  const sk = newKeyPair()
  const [client, server] = await Promise.all([
    connectChannel(a, newKeyPair(), sk.pub, clientInfo),
    acceptChannel(b, sk, () => true, serverInfo)
  ])
  const reasons: string[] = []
  client.onClose(r => reasons.push(r))
  server.serve(async () => 'ok')
  // Server sends a response nobody asked for, via its own cipher path.
  ;(server as unknown as { send(f: Frame): void }).send({ k: 'res', id: 999, ok: true, value: 1 })
  assert.equal(await client.request('x', 1), 'ok')
  assert.deepEqual(reasons, [])
  client.close()
})

test('request times out and clears its timer', async () => {
  const { client, server } = await connected()
  server.serve(() => new Promise(() => {}))
  await assert.rejects(client.request('x', 1, 20), { message: 'sem resposta' })
  client.close()
})

test('no Hello2 within timeoutMs rejects connect with "sem resposta"', async () => {
  const [a] = pair()
  await assert.rejects(connectChannel(a, newKeyPair(), newKeyPair().pub, clientInfo, 30), { message: 'sem resposta' })
  assert.ok(a.closed)
})

test('decodeFrame validates shape', () => {
  assert.equal(decodeFrame('nope'), null)
  assert.equal(decodeFrame('[]'), null)
  assert.equal(decodeFrame('{"k":"req","id":"1","channel":"x"}'), null)
  assert.equal(decodeFrame('{"k":"res","id":1,"ok":false}'), null)
  assert.equal(decodeFrame('{"k":"hello","protocol":1,"machine":{"id":"a","name":"b","os":"bsd"}}'), null)
  assert.deepEqual(decodeFrame('{"k":"push","topic":"t","payload":1}'), { k: 'push', topic: 't', payload: 1 })
})
