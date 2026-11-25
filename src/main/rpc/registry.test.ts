import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Registry } from './registry.ts'
import { EXPECTED_CHANNELS, RULES } from './channels.ts'

const remote = (terminal = false) => ({ remote: { deviceId: 'd', terminal } })

test('local call to a deny channel runs the handler', async () => {
  const r = new Registry()
  r.add('settings:set', (a) => `ok:${a}`, 'deny')
  assert.equal(await r.invoke('settings:set', 1, {}), 'ok:1')
})

test('remote call to deny/local-only is refused', async () => {
  const r = new Registry()
  r.add('settings:set', () => 1, 'deny')
  r.add('attach:open', () => 1, 'local-only')
  await assert.rejects(r.invoke('settings:set', 1, remote()), /^Error: Não permitido remotamente: settings:set$/)
  await assert.rejects(r.invoke('attach:open', 1, remote()), /Não permitido remotamente: attach:open/)
})

test('remote terminal needs the device flag', async () => {
  const r = new Registry()
  r.add('term:write', () => 'w', 'terminal')
  await assert.rejects(r.invoke('term:write', 1, remote(false)), /Terminal remoto não liberado para este dispositivo/)
  assert.equal(await r.invoke('term:write', 1, remote(true)), 'w')
})

test('remote pass runs; unknown channel rejects', async () => {
  const r = new Registry()
  r.add('state:get', () => 's', 'pass')
  assert.equal(await r.invoke('state:get', undefined, remote()), 's')
  await assert.rejects(r.invoke('x', 1, {}), /Canal desconhecido: x/)
})

test('adding a channel twice throws', () => {
  const r = new Registry()
  r.add('a', () => 1, 'pass')
  assert.throws(() => r.add('a', () => 2, 'pass'))
})

test('every channel the preload invokes is in the rule table', () => {
  const src = readFileSync(new URL('../../preload/index.ts', import.meta.url), 'utf8')
  const used = [...src.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1])
  assert.ok(used.length > 0)
  for (const c of used) assert.ok(EXPECTED_CHANNELS.includes(c), `missing in channels.ts: ${c}`)
  for (const c of EXPECTED_CHANNELS) assert.ok(used.includes(c), `not used by preload: ${c}`)
  assert.equal(Object.keys(RULES).length, EXPECTED_CHANNELS.length)
})
