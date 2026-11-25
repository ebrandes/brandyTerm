import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RESULT_CAP } from './calls.ts'
import { call, mk, ref, setup, sig, sleep } from './calls-fixture.ts'

test('list shows only connectors visible to the thread project, without secrets or command', async () => {
  const s = setup({ connectors: [mk(), mk({ id: 'c2', name: 'Other', projects: ['/elsewhere'] }), mk({ id: 'c3', name: 'Off', enabled: false })] })
  assert.deepEqual(await s.handle(ref, s.req('list'), sig()), [{ name: 'Railway', description: 'Deploys' }])
})

test('unknown thread', async () => {
  const s = setup({ noThread: true })
  await assert.rejects(s.handle(ref, s.req('list'), sig()), { message: 'Thread encerrada' })
})

test('missing here, present elsewhere: message names both machines and the thread is notified', async () => {
  const s = setup({ connectors: [], elsewhere: 'Mac' })
  const msg = 'Railway não está instalado em PC; está em Mac. Instale pelo painel Conectores em PC.'
  await assert.rejects(call(s), { message: msg })
  assert.deepEqual(s.log.notified, [msg])
})

test('missing everywhere', async () => {
  const s = setup({ connectors: [] })
  const msg = 'Railway não está instalado em PC. Instale pelo painel Conectores.'
  await assert.rejects(call(s), { message: msg })
  assert.deepEqual(s.log.notified, [msg])
})

test('lookup by name ignores case', async () => {
  const s = setup()
  assert.equal(await call(s, { name: 'RAILWAY' }), 'ok')
})

test('disabled', async () => {
  const s = setup({ connectors: [mk({ enabled: false })] })
  await assert.rejects(call(s), { message: 'Railway está desativado no painel Conectores.' })
  assert.deepEqual(s.log.order, [])
})

test('project-restricted connector is refused on call and on tools', async () => {
  const s = setup({ connectors: [mk({ projects: ['/elsewhere'] })] })
  await assert.rejects(call(s), { message: 'Railway não está liberado para este projeto.' })
  await assert.rejects(s.handle(ref, s.req('tools', { name: 'Railway' }), sig()), { message: 'Railway não está liberado para este projeto.' })
  assert.deepEqual(s.log.order, [])
})

test('connector_tools lists tools as compact JSON', async () => {
  const s = setup()
  assert.equal(await s.handle(ref, s.req('tools', { name: 'Railway' }), sig()), JSON.stringify([{ name: 'get_logs', description: 'Logs', inputSchema: { type: 'object' } }]))
})

test('connector_tools is held for login first', async () => {
  const s = setup({ needsLogin: true })
  await s.handle(ref, s.req('tools', { name: 'Railway' }), sig())
  assert.deepEqual(s.log.order, ['login', 'tools'])
})

test('needs login holds, then continues to approval, then the call', async () => {
  const s = setup({ needsLogin: true })
  assert.equal(await call(s), 'ok')
  assert.deepEqual(s.log.order, ['login', 'tools', 'ask', 'call'])
})

test('a login that is cancelled rejects the call before approval', async () => {
  const s = setup({ needsLogin: true, loginError: new Error('login do Railway cancelado') })
  await assert.rejects(call(s), { message: 'login do Railway cancelado' })
  assert.deepEqual(s.log.order, ['login'])
})

test('alwaysAllow skips approval', async () => {
  const s = setup({ connectors: [mk({ alwaysAllow: ['get_logs'] })] })
  assert.equal(await call(s), 'ok')
  assert.deepEqual(s.log.asks, [])
})

test('forever stores the tool, releases the other cards and the call runs', async () => {
  const s = setup()
  s.setAnswer('forever')
  assert.equal(await call(s), 'ok')
  assert.deepEqual(s.log.allowed, [['c1', 'get_logs']])
  assert.deepEqual(s.log.released, [['c1', 'get_logs']])
  assert.deepEqual(s.log.order, ['tools', 'ask', 'call'])
})

test('deny', async () => {
  const s = setup()
  s.setAnswer('deny')
  await assert.rejects(call(s), { message: 'Chamada negada pelo usuário' })
  assert.deepEqual(s.log.order, ['tools', 'ask'])
})

test('approval hold timeout aborts the ask', async () => {
  const s = setup({ hold: true, holdMs: 50 })
  await assert.rejects(call(s), { message: 'Tempo esgotado esperando aprovação' })
  assert.equal(s.log.asks[0].signal.aborted, true)
  assert.deepEqual(s.log.order, ['tools', 'ask'])
})

test('thread cancel while waiting on approval aborts the ask', async () => {
  const s = setup({ hold: true })
  const ctl = new AbortController()
  const p = call(s, {}, ctl.signal)
  await sleep(10)
  assert.equal(s.log.asks[0].signal.aborted, false)
  ctl.abort()
  await assert.rejects(p, { message: 'Chamada cancelada' })
  assert.equal(s.log.asks[0].signal.aborted, true)
  assert.deepEqual(s.log.order, ['tools', 'ask'])
})

test('an already aborted request never asks', async () => {
  const s = setup({ hold: true })
  const ctl = new AbortController()
  ctl.abort()
  await assert.rejects(call(s, {}, ctl.signal), { message: 'Chamada cancelada' })
  assert.deepEqual(s.log.order, [])
})

test('the request signal reaches the connector call', async () => {
  const s = setup()
  const ctl = new AbortController()
  await call(s, {}, ctl.signal)
  assert.equal(s.log.calls[0][2], ctl.signal)
})

test('huge result is capped', async () => {
  const s = setup({ result: { content: [{ type: 'text', text: 'x'.repeat(300_000) }] } })
  const out = await call(s)
  assert.equal(out, 'x'.repeat(RESULT_CAP) + '\n(resultado cortado em 100000 caracteres)')
})

test('non-text parts become placeholders and parts are joined', async () => {
  const s = setup({ result: { content: [{ type: 'text', text: 'a' }, { type: 'image', mimeType: 'image/png', data: 'AAAA' }] } })
  assert.equal(await call(s), 'a\n[imagem image/png, 3 bytes]')
})

test('approval card carries the arguments', async () => {
  const s = setup()
  await call(s, { args: { n: 1 } })
  const a = s.log.asks[0]
  assert.deepEqual(a.connector, { id: 'c1', name: 'Railway', tool: 'get_logs' })
  assert.equal(a.summary, 'Railway · get_logs')
  assert.equal(a.detail, JSON.stringify({ n: 1 }, null, 2))
  assert.deepEqual(a.input, { n: 1 })
})

test('arguments up to 8000 characters show whole on the card', async () => {
  const s = setup()
  const args = { sql: 'y'.repeat(7000) }
  await call(s, { args })
  assert.equal(s.log.asks[0].detail, JSON.stringify(args, null, 2))
})

test('longer arguments are cut at 8000 with a visible line saying so', async () => {
  const s = setup()
  const args = { sql: ' '.repeat(9000) + 'DROP TABLE users' }
  await call(s, { args })
  const full = JSON.stringify(args, null, 2)
  assert.equal(s.log.asks[0].detail, `${full.slice(0, 8000)}\n(argumentos cortados: 8000 de ${full.length} caracteres)`)
})

test('a connector error comes back as a rejection, not a crash', async () => {
  const s = setup({ callError: new Error('boom') })
  await assert.rejects(call(s), { message: 'boom' })
})

test('an isError result becomes a rejection with its text', async () => {
  const s = setup({ result: { isError: true, content: [{ type: 'text', text: 'bad input' }] } })
  await assert.rejects(call(s), { message: 'bad input' })
})

test('missing name or tool is refused', async () => {
  const s = setup()
  await assert.rejects(s.handle(ref, s.req('tools'), sig()), { message: 'Informe o nome do conector' })
  await assert.rejects(call(s, { tool: undefined }), { message: 'Informe a ferramenta' })
})

test('a connector removed while its card is pending never runs', async () => {
  const list = [mk()]
  const s = setup({ connectors: list, defer: true })
  const p = call(s)
  const failed = assert.rejects(p, { message: 'Railway foi removido.' })
  await sleep(5)
  list.length = 0
  s.answerNow('allow')
  await failed
  assert.deepEqual(s.log.calls, [])
})

test('a connector disabled while its card is pending never runs', async () => {
  const list = [mk()]
  const s = setup({ connectors: list, defer: true })
  const p = call(s)
  const failed = assert.rejects(p, { message: 'Railway está desativado.' })
  await sleep(5)
  list[0] = { ...list[0], enabled: false }
  s.answerNow('allow')
  await failed
  assert.deepEqual(s.log.calls, [])
})

test('a connector removed while the login is pending never reaches approval', async () => {
  const list = [mk()]
  const s = setup({ connectors: list, needsLogin: true })
  const p = s.handle(ref, s.req('call', { name: 'Railway', tool: 'get_logs' }), sig())
  list.length = 0
  await assert.rejects(p, { message: 'Railway foi removido.' })
  assert.deepEqual(s.log.asks, [])
})
