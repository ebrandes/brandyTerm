import test from 'node:test'
import assert from 'node:assert/strict'
import { ThreadReporter } from './thread-report.ts'
import { askPrompt, followUpPrompt } from './thread-report-text.ts'
import { fakeHost, flush, plan, project, thread } from './thread-report-fixture.ts'

const BUSY = 'A thread “T” está ocupada; pergunto quando ela parar.'
const NO_SESSION = 'A thread “T” ainda não tem conversa para consultar.'

test('ask on an idle thread: runs askPrompt, then the coordinator turns the answer into a reply', async () => {
  const f = fakeHost()
  f.state.coordinator = { plan: plan('O login usa JWT.', [{ section: 'Recente', text: 'x' }]) }
  const r = new ThreadReporter(f.host)
  const t = thread()
  const p = project(t)
  assert.equal(r.ask(p, t, 'Qual auth?'), '')
  assert.equal(f.runs.length, 1)
  assert.equal(f.runs[0].prompt, askPrompt('Qual auth?'))
  assert.equal(r.busy(t.id), true)
  assert.equal(t.reporting, undefined)
  f.runs[0].resolve({ ok: true, text: ' JWT, em auth.ts. ', sessionId: 's2' })
  await flush()
  assert.equal(r.busy(t.id), false)
  assert.equal(t.sessionId, 's2')
  assert.equal(p.messages.length, 0)
  assert.equal(f.jobs.length, 1)
  await f.runJobs()
  assert.deepEqual(f.prompts, [followUpPrompt('T', 'Qual auth?', 'JWT, em auth.ts.')])
  assert.equal(p.messages.length, 1)
  assert.equal(p.messages[0].author, 'coordinator')
  assert.equal(p.messages[0].text, 'O login usa JWT.')
  assert.deepEqual(f.remembered, [])
  assert.deepEqual(t.messages, [])
})

test('ask on a running thread says it is busy and runs only after afterRun with the thread stopped', async () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread({ state: 'running' })
  const p = project(t)
  assert.equal(r.ask(p, t, 'Qual auth?'), BUSY)
  assert.equal(f.runs.length, 0)
  r.afterRun(p, t)
  assert.equal(f.runs.length, 0)
  t.state = 'done'
  r.afterRun(p, t)
  assert.equal(f.runs.length, 1)
  assert.equal(f.runs[0].prompt, askPrompt('Qual auth?'))
})

test('ask on a thread without session gives the notice and runs nothing', () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread({ sessionId: undefined })
  assert.equal(r.ask(project(t), t, 'Qual auth?'), NO_SESSION)
  assert.equal(f.runs.length, 0)
})

test('ask follow-up error posts "Não consegui repassar a resposta"', async () => {
  const f = fakeHost()
  f.state.coordinator = { error: 'fora do ar' }
  const r = new ThreadReporter(f.host)
  const t = thread()
  const p = project(t)
  r.ask(p, t, 'Qual auth?')
  f.runs[0].resolve({ ok: true, text: 'JWT' })
  await flush()
  await f.runJobs()
  assert.equal(p.messages.length, 1)
  assert.equal(p.messages[0].author, 'system')
  assert.equal(p.messages[0].text, 'Não consegui repassar a resposta da thread “T”.')
  assert.equal(p.messages[0].isError, true)
})

test('ask run failure posts "Não consegui perguntar" and asks the coordinator nothing', async () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread()
  const p = project(t)
  r.ask(p, t, 'Qual auth?')
  f.runs[0].resolve({ ok: false, text: '', error: 'boom' })
  await flush()
  assert.equal(p.messages.length, 1)
  assert.equal(p.messages[0].text, 'Não consegui perguntar à thread “T”: boom')
  assert.equal(p.messages[0].isError, true)
  assert.equal(f.jobs.length, 0)
})

test('a question asked while a report runs goes after the report, without afterRun', async () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread()
  const p = project(t)
  r.report(p, t, 'curto')
  assert.equal(r.ask(p, t, 'Qual auth?'), BUSY)
  assert.equal(f.runs.length, 1)
  f.runs[0].resolve({ ok: true, text: 'FEITO: x' })
  await flush()
  assert.equal(f.runs.length, 2)
  assert.equal(f.runs[1].prompt, askPrompt('Qual auth?'))
  assert.equal(t.reporting, false)
})

test('queued questions run one at a time, in order', async () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread({ state: 'queued' })
  const p = project(t)
  assert.equal(r.ask(p, t, 'um'), BUSY)
  assert.equal(r.ask(p, t, 'dois'), BUSY)
  t.state = 'done'
  r.afterRun(p, t)
  r.afterRun(p, t)
  assert.deepEqual(f.runs.map((x) => x.prompt), [askPrompt('um')])
  f.runs[0].resolve({ ok: true, text: 'a' })
  await flush()
  assert.deepEqual(f.runs.map((x) => x.prompt), [askPrompt('um'), askPrompt('dois')])
  f.runs[1].resolve({ ok: true, text: 'b' })
  await flush()
  assert.equal(f.runs.length, 2)
  await f.runJobs()
  assert.deepEqual(f.prompts, [followUpPrompt('T', 'um', 'a'), followUpPrompt('T', 'dois', 'b')])
})

test('afterRun with queued questions and still no session drops them with one notice', () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread({ state: 'running', sessionId: undefined })
  const p = project(t)
  assert.equal(r.ask(p, t, 'um'), BUSY)
  assert.equal(r.ask(p, t, 'dois'), BUSY)
  t.state = 'failed'
  r.afterRun(p, t)
  r.afterRun(p, t)
  assert.equal(f.runs.length, 0)
  assert.equal(p.messages.length, 1)
  assert.equal(p.messages[0].author, 'system')
  assert.equal(p.messages[0].text, NO_SESSION)
  assert.equal(p.messages[0].isError, true)
})

test('a cancelled ask is asked again on the next afterRun; its late result is ignored', async () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread()
  const p = project(t)
  r.ask(p, t, 'Qual auth?')
  r.cancel(t.id)
  assert.equal(f.runs[0].cancelled, true)
  assert.equal(r.busy(t.id), false)
  t.state = 'running'
  f.runs[0].resolve({ ok: true, text: 'JWT', sessionId: 'velha' })
  await flush()
  assert.equal(f.jobs.length, 0)
  assert.equal(p.messages.length, 0)
  assert.equal(t.sessionId, 's1')
  assert.equal(f.runs.length, 1)
  t.state = 'done'
  r.afterRun(p, t)
  assert.equal(f.runs.length, 2)
  assert.equal(f.runs[1].prompt, askPrompt('Qual auth?'))
})
