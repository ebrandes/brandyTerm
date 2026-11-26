import test from 'node:test'
import assert from 'node:assert/strict'
import { ThreadReporter } from './thread-report.ts'
import { parseReport, reportNotes, reportPrompt } from './thread-report-text.ts'
import { fakeHost, flush, project, thread } from './thread-report-fixture.ts'

const REPORT = 'FEITO: login pronto\nDECIDIDO: usar JWT\nARQUIVOS: auth.ts\nPENDENTE: testes e2e'

test('report curto: one agent message with the summary, memory notes, summary and reportedAt', async () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread({ summary: 'antigo' })
  const p = project(t)
  assert.equal(r.report(p, t, 'curto'), true)
  assert.equal(f.runs.length, 1)
  assert.equal(f.runs[0].prompt, reportPrompt('curto'))
  assert.equal(t.reporting, true)
  assert.equal(r.busy(t.id), true)
  f.runs[0].resolve({ ok: true, text: REPORT })
  await flush()
  assert.equal(p.messages.length, 1)
  const m = p.messages[0]
  assert.equal(m.author, 'agent')
  assert.equal(m.text, 'Resumo da thread “T”')
  assert.deepEqual(m.summaries, [{ agent: 'claude', title: 'T', text: REPORT, threadId: 't1' }])
  assert.deepEqual(f.remembered, [reportNotes('T', parseReport(REPORT), 'curto')])
  assert.equal(t.summary, 'login pronto')
  assert.ok(t.reportedAt && !Number.isNaN(Date.parse(t.reportedAt)))
  assert.equal(t.reporting, false)
  assert.equal(r.busy(t.id), false)
  assert.ok(f.state.touches >= 2)
})

test('report completo: "Relatório" message and notes with the pending line', async () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread()
  const p = project(t)
  r.report(p, t, 'completo')
  assert.equal(f.runs[0].prompt, reportPrompt('completo'))
  f.runs[0].resolve({ ok: true, text: REPORT })
  await flush()
  assert.equal(p.messages[0].text, 'Relatório da thread “T”')
  assert.deepEqual(f.remembered, [reportNotes('T', parseReport(REPORT), 'completo')])
  assert.ok(f.remembered[0].some((n) => n.section === 'Pendências'))
})

test('report keeps the thread visible state untouched', async () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread({
    note: 'nota',
    pending: 'algo',
    resolved: false,
    todos: [{ text: 'x', status: 'completed' }],
    steps: ['passo'],
    messages: [{ id: 'a', author: 'agent', time: 'x', text: 'oi' }]
  })
  const p = project(t)
  const pick = () => structuredClone({ ...t, summary: undefined, reportedAt: undefined, reporting: undefined })
  const before = pick()
  r.report(p, t, 'completo')
  f.runs[0].resolve({ ok: true, text: REPORT })
  await flush()
  assert.deepEqual(pick(), before)
})

test('report without FEITO keeps the old summary and sends the whole text', async () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread({ summary: 'antigo' })
  const p = project(t)
  r.report(p, t, 'curto')
  f.runs[0].resolve({ ok: true, text: '  texto solto  ' })
  await flush()
  assert.equal(t.summary, 'antigo')
  assert.equal(p.messages[0].summaries?.[0].text, 'texto solto')
})

test('report saves a new sessionId from the run', async () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread()
  r.report(project(t), t, 'curto')
  f.runs[0].resolve({ ok: true, text: REPORT, sessionId: 's2' })
  await flush()
  assert.equal(t.sessionId, 's2')
})

test('report without sessionId returns false and runs nothing', () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread({ sessionId: undefined })
  assert.equal(r.report(project(t), t, 'completo'), false)
  assert.equal(f.runs.length, 0)
  assert.equal(t.reporting, undefined)
})

test('report while busy returns false (one at a time, not on a running or queued thread)', () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread()
  const p = project(t)
  assert.equal(r.report(p, t, 'curto'), true)
  assert.equal(r.report(p, t, 'completo'), false)
  for (const state of ['running', 'queued'] as const) {
    const u = thread({ id: state, state })
    assert.equal(r.report(project(u), u, 'completo'), false)
  }
  assert.equal(f.runs.length, 1)
})

test('report failure: completo posts an error, curto calls onFail and posts nothing', async () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread()
  const p = project(t)
  r.report(p, t, 'completo')
  f.runs[0].resolve({ ok: false, text: '', error: 'limite' })
  await flush()
  assert.equal(p.messages.length, 1)
  assert.equal(p.messages[0].author, 'system')
  assert.equal(p.messages[0].text, 'Não consegui o resumo da thread “T”: limite')
  assert.equal(p.messages[0].isError, true)
  assert.equal(t.reporting, false)
  assert.equal(t.reportedAt, undefined)

  let failed = 0
  r.report(p, t, 'curto', () => failed++)
  f.runs[1].resolve({ ok: false, text: '' })
  await flush()
  assert.equal(failed, 1)
  assert.equal(p.messages.length, 1)
  assert.deepEqual(f.remembered, [])
})

test('report with an empty answer counts as failure "sem resposta"', async () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread()
  const p = project(t)
  r.report(p, t, 'completo')
  f.runs[0].resolve({ ok: true, text: '  \n ' })
  await flush()
  assert.equal(p.messages[0].text, 'Não consegui o resumo da thread “T”: sem resposta')
})

test('a run whose result rejects is a failure, with reporting cleared', async () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread()
  const p = project(t)
  r.report(p, t, 'completo')
  f.runs[0].reject(new Error('quebrou'))
  await flush()
  assert.equal(p.messages[0].text, 'Não consegui o resumo da thread “T”: quebrou')
  assert.equal(t.reporting, false)
  assert.equal(r.busy(t.id), false)
})

test('cancel during a report: run cancelled, late result ignored, reporting false', async () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  const t = thread()
  const p = project(t)
  r.report(p, t, 'curto')
  r.cancel(t.id)
  assert.equal(f.runs[0].cancelled, true)
  assert.equal(t.reporting, false)
  assert.equal(r.busy(t.id), false)
  // a new report may start while the old result is still on its way
  assert.equal(r.report(p, t, 'completo'), true)
  f.runs[0].resolve({ ok: true, text: REPORT, sessionId: 'velha' })
  await flush()
  assert.equal(p.messages.length, 0)
  assert.equal(t.sessionId, 's1')
  assert.equal(t.reporting, true)
  assert.equal(r.busy(t.id), true)
  f.runs[1].resolve({ ok: true, text: REPORT })
  await flush()
  assert.equal(p.messages.length, 1)
  assert.equal(p.messages[0].text, 'Relatório da thread “T”')
})

test('cancel on a thread with nothing running is a no-op', () => {
  const f = fakeHost()
  const r = new ThreadReporter(f.host)
  r.cancel('t1')
  assert.equal(f.state.touches, 0)
})
