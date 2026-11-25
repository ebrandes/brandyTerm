// Secure channel: requests, responses and pushes once connected.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptChannel, connectChannel } from './channel.ts'
import { newKeyPair } from './crypto.ts'
import { decodeFrame, type Frame } from './protocol.ts'
import { asBufferView, pair, clientInfo, serverInfo, sleep, connected } from './channel-rig.ts'

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

test('first request and push, delivered in the same batch as the hello, are not lost', async () => {
  const [a, b] = pair()
  a.hold = true
  const sk = newKeyPair()
  const [clientP, server] = [
    connectChannel(a, newKeyPair(), sk.pub, clientInfo),
    await acceptChannel(b, sk, () => true, serverInfo)
  ]
  const reply = server.request('q', 2)
  server.push('p', 1)
  await sleep(5)
  a.release()
  const client = await clientP
  const pushes: unknown[] = []
  client.onPush((t, p) => pushes.push([t, p]))
  client.serve(async (ch, arg) => [ch, arg])
  assert.deepEqual(await reply, ['q', 2])
  assert.deepEqual(pushes, [['p', 1]])
  client.close()
})

test('queue overflow closes with "fila cheia"', async () => {
  const { client, server } = await connected()
  const reasons: string[] = []
  server.onClose(r => reasons.push(r))
  for (let i = 0; i < 257; i++) client.push('t', i)
  await sleep(10)
  assert.deepEqual(reasons, ['fila cheia'])
})

test('non-serialisable request rejects only that request; handler result becomes an error response', async () => {
  const { client, server } = await connected()
  server.serve(async (ch) => (ch === 'big' ? 10n : 'ok'))
  await assert.rejects(client.request('x', 1n))
  await assert.rejects(client.request('big', 1), { message: 'resposta inválida' })
  assert.equal(await client.request('y', 1), 'ok')
  client.close()
})

test('throwing onPush and onClose callbacks do not escape or stop other callbacks', async () => {
  const { client, server } = await connected()
  client.onPush(() => { throw new Error('x') })
  const seen: string[] = []
  client.onClose(() => { throw new Error('y') })
  client.onClose(r => seen.push(r))
  server.push('a', 1)
  server.push('b', 2)
  await sleep(5)
  client.close('fim')
  assert.deepEqual(seen, ['fim'])
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

test('decodeFrame validates shape', () => {
  assert.equal(decodeFrame('nope'), null)
  assert.equal(decodeFrame('[]'), null)
  assert.equal(decodeFrame('{"k":"req","id":"1","channel":"x"}'), null)
  assert.equal(decodeFrame('{"k":"res","id":1,"ok":false}'), null)
  assert.equal(decodeFrame('{"k":"hello","protocol":1,"machine":{"id":"a","name":"b","os":"bsd"}}'), null)
  assert.deepEqual(decodeFrame('{"k":"push","topic":"t","payload":1}'), { k: 'push', topic: 't', payload: 1 })
})

test('Uint8Array travels as binary at any depth; Buffer with a byteOffset too', async () => {
  const { client, server } = await connected()
  server.serve(async (_c, arg) => arg)
  const buf = Buffer.from('xxhello', 'utf8').subarray(2)
  assert.notEqual(buf.byteOffset, 0)
  const out = await client.request('echo', { projectId: 'p', data: new Uint8Array([0, 1, 255]), deep: [{ b: buf }] }) as {
    data: Uint8Array; deep: { b: Uint8Array }[]
  }
  assert.ok(out.data instanceof Uint8Array)
  assert.deepEqual([...out.data], [0, 1, 255])
  assert.equal(Buffer.from(out.deep[0].b).toString(), 'hello')
  client.close()
})

test('a malformed $b64 tag is an invalid frame; a plain {"$b64": ...} string cannot smuggle bytes', async () => {
  const { parseBinary } = await import('./binary.ts')
  assert.throws(() => parseBinary('{"$b64":"@@@"}'))
  assert.throws(() => parseBinary('{"$b64":5}'))
  assert.throws(() => parseBinary('{"$b64":"AA==","x":1}'))
  assert.equal(decodeFrame('{"k":"push","topic":"t","payload":{"$b64":"@@"}}'), null)
  assert.deepEqual(parseBinary('{"a":"$b64"}'), { a: '$b64' })
})
