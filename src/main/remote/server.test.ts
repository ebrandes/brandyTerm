import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newKeyPair, toB64, fromB64 } from '../../shared/remote/crypto.ts'
import { verifyHostProof } from '../../shared/remote/pairing.ts'
import { parsePaired, parsePairFail } from '../../shared/remote/pair-wire.ts'
import type { AppState } from '../../shared/types.ts'
import { closed, exchange, pairMsg, withHost } from './server-rig.ts'

test('state:get is filtered; hidden project and denied channel are refused', () => withHost(async e => {
  const ch = await e.connect()
  const s = await ch.request('state:get', undefined) as AppState
  assert.deepEqual(s.projects.map(p => p.id), ['a'])
  assert.ok(!JSON.stringify(s).includes('sk-ant-xyz'))
  assert.equal(s.settings?.lastSeen, undefined)
  assert.equal(await ch.request('chat:send', { projectId: 'a' }), 'sent:a')
  await assert.rejects(ch.request('chat:send', { projectId: 'b' }), /^Error: Projeto não disponível remotamente$/)
  await assert.rejects(ch.request('chat:send', { projectId: 'zzz' }), /^Error: Projeto não disponível remotamente$/)
  await assert.rejects(ch.request('settings:set', {}), /^Error: Não permitido remotamente: settings:set$/)
  ch.close()
}))

test('fs:list is confined to the project for remote callers', () => withHost(async e => {
  const ch = await e.connect()
  assert.deepEqual(await ch.request('fs:list', { projectId: 'a', query: 'src' }), ['listed'])
  for (const query of ['/', '~/', '../x']) {
    await assert.rejects(ch.request('fs:list', { projectId: 'a', query }), /^Error: Fora do projeto$/)
  }
  assert.equal(e.calls.filter(c => c.channel === 'fs:list').length, 1)
  ch.close()
}))

test('archive:list only sees visible projects', () => withHost(async e => {
  const ch = await e.connect()
  assert.deepEqual(await ch.request('archive:list', ['a', 'b', 'q', 7]), ['a'])
  assert.deepEqual(await ch.request('archive:list', 'a'), [])
  ch.close()
}))

test('terminal permission is read per request and keyed on the verified key', () => withHost(async e => {
  const ch = await e.connect()
  await assert.rejects(ch.request('term:write', { id: 'a', data: 'x' }), /Terminal remoto não liberado/)
  e.trust.setTerminal(toB64(e.client.pub), true)
  assert.equal(await ch.request('term:write', { id: 'a', data: 'x' }), 'wrote')
  assert.equal(e.calls.at(-1)?.ctx.remote?.deviceId, toB64(e.client.pub))
  ch.close()
}))

test('revoking closes the channel and a reconnect is refused', () => withHost(async e => {
  const ch = await e.connect()
  await ch.request('state:get', undefined)
  const done = closed(ch)
  e.trust.revoke(toB64(e.client.pub))
  await done
  await assert.rejects(ch.request('state:get', undefined), /desconectada/)
  await assert.rejects(e.connect())
}))

test('an untrusted key is refused at accept', () => withHost(async e => {
  await assert.rejects(e.connect(newKeyPair()))
  assert.equal(e.host.clients().length, 0)
}))

test('state is pushed to connected clients, debounced', () => withHost(async e => {
  const ch = await e.connect()
  const pushes: unknown[] = []
  ch.onPush((topic, payload) => { if (topic === 'state') pushes.push(payload) })
  await ch.request('state:get', undefined)
  e.bus.emit('change'); e.bus.emit('change'); e.bus.emit('change')
  await new Promise(r => setTimeout(r, 300))
  assert.equal(pushes.length, 2) // one on accept, one debounced for the three changes
  assert.deepEqual((pushes[1] as AppState).projects.map(p => p.id), ['a'])
  ch.close()
}))

test('clients() lists connections and touch records lastSeen', () => withHost(async e => {
  const ch = await e.connect()
  await ch.request('state:get', undefined)
  assert.deepEqual(e.host.clients().map(c => c.pub), [toB64(e.client.pub)])
  assert.ok(e.trust.get(toB64(e.client.pub), 'client')?.lastSeen)
  ch.close()
}))

test('pairing round trip: right code pairs, host proof verifies, then the key is trusted', () => withHost(async e => {
  const code = e.host.openPairing()
  const key = newKeyPair()
  const { nonceC, text } = pairMsg(code, key)
  const ws = await e.raw()
  const reply = parsePaired(await exchange(ws, text))
  assert.ok(reply)
  assert.ok(verifyHostProof(code, fromB64(reply.hpub), key.pub, fromB64(reply.nonceH), nonceC, reply.proof))
  assert.equal(reply.hpub, toB64(e.trust.ownKey().pub))
  assert.equal(e.trust.get(toB64(key.pub), 'client')?.name, 'Celular')
  assert.equal(e.trust.get(toB64(key.pub), 'client')?.terminal, false)
  await new Promise(r => ws.once('close', r)) // single-use socket
  const ch = await e.connect(key)
  assert.ok(await ch.request('state:get', undefined))
  ch.close()
}))

test('wrong code three times closes pairing, even for the right code', () => withHost(async e => {
  const code = e.host.openPairing()
  const key = newKeyPair()
  for (let i = 0; i < 3; i++) {
    const ws = await e.raw()
    const r = parsePairFail(await exchange(ws, pairMsg('0000-0000-0000-0000', key).text))
    assert.equal(r?.reason, 'código inválido')
  }
  const ws = await e.raw()
  const r = parsePairFail(await exchange(ws, pairMsg(code, key).text))
  assert.equal(r?.reason, 'pareamento fechado')
  assert.equal(e.trust.get(toB64(key.pub), 'client'), undefined)
}))

test('pairing refused when the window was never opened', () => withHost(async e => {
  const ws = await e.raw()
  const r = parsePairFail(await exchange(ws, pairMsg('0000-0000-0000-0000', newKeyPair()).text))
  assert.equal(r?.reason, 'pareamento fechado')
}))

test('malformed pair counts as a bad attempt: it plus two wrong codes closes pairing', () => withHost(async e => {
  const code = e.host.openPairing()
  const key = newKeyPair()
  let ws = await e.raw()
  assert.equal(parsePairFail(await exchange(ws, JSON.stringify({ t: 'pair', cpub: 'x' })))?.reason, 'código inválido')
  for (let i = 0; i < 2; i++) {
    ws = await e.raw()
    assert.equal(parsePairFail(await exchange(ws, pairMsg('0000-0000-0000-0000', key).text))?.reason, 'código inválido')
  }
  ws = await e.raw()
  assert.equal(parsePairFail(await exchange(ws, pairMsg(code, key).text))?.reason, 'pareamento fechado')
  assert.equal(e.trust.get(toB64(key.pub), 'client'), undefined)
}))

test('wrong protocol is reported and does not use up an attempt', () => withHost(async e => {
  const code = e.host.openPairing()
  const key = newKeyPair()
  for (let i = 0; i < 4; i++) {
    const ws = await e.raw()
    assert.equal(parsePairFail(await exchange(ws, pairMsg(code, key, { protocol: 99 }).text))?.reason, 'versão diferente')
  }
  const ws = await e.raw()
  assert.ok(parsePaired(await exchange(ws, pairMsg(code, key).text)))
}))

test('a pairing socket is closed after the reply and ignores further messages', () => withHost(async e => {
  const ws = await e.raw()
  const reply = exchange(ws, JSON.stringify({ t: 'pair', cpub: 'x' }))
  for (let i = 0; i < 50; i++) ws.send('spam')
  await reply
  await new Promise(r => ws.once('close', r))
}))

test('hiding a project mid-session blocks it and drops it from the next push', () => withHost(async e => {
  const ch = await e.connect()
  const pushes: AppState[] = []
  ch.onPush((t, p) => { if (t === 'state') pushes.push(p as AppState) })
  assert.equal(await ch.request('chat:send', { projectId: 'a' }), 'sent:a')
  e.state.projects[0].remoteHidden = true
  await assert.rejects(ch.request('chat:send', { projectId: 'a' }), /^Error: Projeto não disponível remotamente$/)
  await assert.rejects(ch.request('chat:send', { projectId: ['a'] }), /^Error: Projeto não disponível remotamente$/)
  e.bus.emit('change')
  await new Promise(r => setTimeout(r, 300))
  assert.equal(pushes.length, 2) // accept + the change after hiding
  assert.deepEqual(pushes[1].projects, [])
  ch.close()
}))

test('revoking during the handshake leaves no live channel', () => withHost(async e => {
  const orig = e.trust.get.bind(e.trust)
  let n = 0
  e.trust.get = (pub, role) => {
    const r = orig(pub, role)
    if (++n === 1) e.trust.revoke(pub) // the accept callback: revoked right after it said yes
    return r
  }
  const ch = await e.connect().catch(() => null)
  if (ch) await closed(ch)
  assert.equal(e.host.clients().length, 0)
}))

test('stop closes channels and sockets', () => withHost(async e => {
  const ch = await e.connect()
  await ch.request('state:get', undefined)
  const done = closed(ch)
  const ws = await e.raw()
  const wsClosed = new Promise(r => ws.once('close', r))
  await e.host.stop()
  await done
  await wsClosed
}))

test('a client gets the filtered state pushed right after the channel is established', () => withHost(async e => {
  const ch = await e.connect()
  const pushed = await new Promise<AppState>(resolve => ch.onPush((topic, p) => { if (topic === 'state') resolve(p as AppState) }))
  assert.deepEqual(pushed.projects.map(p => p.id), ['a'])
  assert.ok(!JSON.stringify(pushed).includes('sk-ant-xyz'))
  ch.close()
}))
