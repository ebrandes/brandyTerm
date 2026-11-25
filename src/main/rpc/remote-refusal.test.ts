import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Registry } from './registry.ts'
import { RULES, type Channel } from './channels.ts'

const remote = { remote: { deviceId: 'd', terminal: true } }

test('every deny / local-only channel is refused for a remote caller without running its handler', async () => {
  const refused = (Object.keys(RULES) as Channel[]).filter((c) => RULES[c] === 'deny' || RULES[c] === 'local-only')
  assert.ok(refused.length > 10)
  for (const ch of refused) {
    const r = new Registry()
    let ran = false
    r.add(ch, () => { ran = true }, RULES[ch])
    await assert.rejects(r.invoke(ch, {}, remote), /Não permitido remotamente/, ch)
    assert.equal(ran, false, `${ch} handler ran for a remote caller`)
  }
})

test('project:set-remote-hidden: deny rule, only the local owner runs it', async () => {
  assert.equal(RULES['project:set-remote-hidden'], 'deny')
  const r = new Registry()
  const calls: unknown[] = []
  r.add('project:set-remote-hidden', (a) => { calls.push(a) }, RULES['project:set-remote-hidden'])
  await assert.rejects(r.invoke('project:set-remote-hidden', { projectId: 'a', hidden: false }, remote), /Não permitido remotamente: project:set-remote-hidden/)
  assert.deepEqual(calls, [])
  await r.invoke('project:set-remote-hidden', { projectId: 'a', hidden: true }, {})
  assert.deepEqual(calls, [{ projectId: 'a', hidden: true }])
})
