import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, ref, setup, sleep } from './calls-fixture.ts'

const cancelled = (signal: AbortSignal) => new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('login do Railway cancelado')), { once: true }))

test('a login that takes most of the deadline leaves only the rest for approval', async () => {
  const s = setup({ needsLogin: true, holdMs: 400, hold: true, require: () => sleep(300) })
  const t0 = Date.now()
  await assert.rejects(call(s), { message: 'Tempo esgotado esperando aprovação' })
  const took = Date.now() - t0
  assert.ok(took >= 380 && took < 600, `took ${took} ms`)
  assert.equal(s.log.asks[0].signal.aborted, true)
  assert.deepEqual(s.log.calls, [])
})

test('the deadline passing during a login withdraws the login waiter', { timeout: 3000 }, async () => {
  const s = setup({ needsLogin: true, holdMs: 100, require: cancelled })
  await assert.rejects(call(s), { message: 'login do Railway cancelado' })
  assert.equal(s.log.loginSignals[0].aborted, true)
  assert.deepEqual(s.log.asks, [])
  assert.deepEqual(s.log.calls, [])
})

test('connector_tools: the login wait also ends at the deadline', { timeout: 3000 }, async () => {
  const s = setup({ needsLogin: true, holdMs: 100, require: cancelled })
  await assert.rejects(s.handle(ref, s.req('tools', { name: 'Railway' }), new AbortController().signal), { message: 'login do Railway cancelado' })
  assert.equal(s.log.loginSignals[0].aborted, true)
})

test('a request cancelled during its login drops the waiter and never asks or calls', async () => {
  const ctl = new AbortController()
  const s = setup({ needsLogin: true, require: cancelled })
  const p = call(s, {}, ctl.signal)
  await sleep(10)
  ctl.abort()
  await assert.rejects(p, { message: 'login do Railway cancelado' })
  assert.equal(s.log.loginSignals[0].aborted, true)
  assert.deepEqual(s.log.asks, [])
  assert.deepEqual(s.log.calls, [])
})

test('a request cancelled while its card is pending removes the card and never calls the hub, even if Permitir comes after', async () => {
  const ctl = new AbortController()
  const s = setup({ defer: true })
  const p = call(s, {}, ctl.signal)
  await sleep(10)
  ctl.abort()
  s.answerNow('allow')
  await assert.rejects(p, { message: 'Chamada cancelada' })
  assert.equal(s.log.asks[0].signal.aborted, true)
  assert.deepEqual(s.log.calls, [])
})

test('a cancel that lands together with Permitir never calls the hub', async () => {
  const ctl = new AbortController()
  const s = setup({ askImpl: async () => { ctl.abort(); return 'allow' } })
  await assert.rejects(call(s, {}, ctl.signal), { message: 'Chamada cancelada' })
  assert.deepEqual(s.log.calls, [])
})
