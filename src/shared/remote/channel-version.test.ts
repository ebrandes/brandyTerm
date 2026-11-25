// Secure channel: a peer that speaks another protocol version.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptChannel, connectChannel } from './channel.ts'
import { FrameCipher, initiatorFinish, initiatorStart, newKeyPair, responderReply } from './crypto.ts'
import { pair, clientInfo, serverInfo, sleep, helloBytes } from './channel-rig.ts'

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
