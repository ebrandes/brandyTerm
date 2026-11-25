// Secure channel: the handshake, key confirmation and frames that close the channel.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptChannel, connectChannel } from './channel.ts'
import { FrameCipher, initiatorFinish, initiatorStart, newKeyPair, toB64 } from './crypto.ts'
import { pair, clientInfo, serverInfo, sleep, helloBytes } from './channel-rig.ts'

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
  // Claims the victim's public key but holds a different static private key.
  const fake = newKeyPair()
  const { msg, e } = initiatorStart(fake)
  a.onMessage(d => {
    if (typeof d !== 'string') return
    const keys = initiatorFinish(fake, e, sk.pub, JSON.parse(d))
    a.send(helloBytes(new FrameCipher(keys), 1, clientInfo))
  })
  a.send(JSON.stringify({ ie: msg.ie, is: toB64(victim.pub) }))
  await assert.rejects(p, { message: 'quadro inválido' })
  assert.ok(b.closed)
})

test('no Hello2 within timeoutMs rejects connect with "sem resposta"', async () => {
  const [a] = pair()
  await assert.rejects(connectChannel(a, newKeyPair(), newKeyPair().pub, clientInfo, 30), { message: 'sem resposta' })
  assert.ok(a.closed)
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
  const origSend = a.send.bind(a)
  a.send = d => {
    if (typeof d === 'string') return origSend(d)
    const t = d.slice()
    t[t.length - 1] ^= 1 // flip one bit of a real sealed frame: counter is right, AEAD fails
    origSend(t)
  }
  const req = client.request('x', 1)
  await assert.rejects(req, { message: 'Máquina desconectada' })
  assert.deepEqual(reasons, ['quadro inválido'])
})

test('stray hello after the handshake closes with "quadro inválido"', async () => {
  const [a, b] = pair()
  const sk = newKeyPair()
  const raw = newKeyPair()
  const p = acceptChannel(b, sk, () => true, serverInfo)
  const { msg, e } = initiatorStart(raw)
  a.onMessage(d => {
    if (typeof d !== 'string') return
    const c = new FrameCipher(initiatorFinish(raw, e, sk.pub, JSON.parse(d)))
    a.send(helloBytes(c, 1, clientInfo))
    a.send(helloBytes(c, 1, clientInfo))
  })
  a.send(JSON.stringify(msg))
  const server = await p
  const reasons: string[] = []
  server.onClose(r => reasons.push(r))
  await sleep(5)
  assert.deepEqual(reasons, ['quadro inválido'])
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
