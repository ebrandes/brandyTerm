import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDecision, settleThread } from './settle.ts'
import { ThreadReporter } from './thread-report.ts'
import { fakeHost, flush, project, thread } from './thread-report-fixture.ts'

const SUMMARY =
  'FEITO: crítica do site salva.\n' +
  'DECIDIDO: nada; o usuário ainda vai escolher prioridade, direção visual e o alcance.\n' +
  'ARQUIVOS: .impeccable/critique/apps-site.md'

test('a summary with an open decision leaves the thread waiting instead of posting it', async () => {
  const f = fakeHost()
  const t = thread({ resolved: true })
  const p = project(t)
  let failed = false
  new ThreadReporter(f.host).report(p, t, 'curto', () => (failed = true))
  f.runs[0].resolve({ ok: true, text: SUMMARY })
  await flush()
  assert.deepEqual([t.state, t.resolved, t.note, t.reportedAt, failed], ['waiting', false, 'Aguardando sua resposta', undefined, false])
  assert.equal(p.messages.length, 1)
  assert.equal(p.messages[0].summaries, undefined)
  assert.equal(p.messages[0].ask?.threadId, 't1')
  assert.equal(p.messages[0].ask?.question, t.question?.text)
  assert.match(t.question!.text, /o usuário ainda vai escolher/)
})

test('a report the user asked for does not reopen the thread', async () => {
  const f = fakeHost()
  const t = thread({ resolved: true })
  const p = project(t)
  new ThreadReporter(f.host).report(p, t, 'completo')
  f.runs[0].resolve({ ok: true, text: SUMMARY })
  await flush()
  assert.deepEqual([t.state, t.resolved, p.messages[0].ask], ['done', true, undefined])
})

test('a closing line that says the decision is open keeps the thread waiting', () => {
  const t = thread({ state: 'running' })
  const text = 'Analisei.\n\nRESUMO: aguardando sua decisão sobre o preço.'
  const q = settleThread(t, { kind: 'done', ok: true, text }, fakeHost().host.msg)
  assert.deepEqual([t.state, t.resolved, q?.text], ['waiting', false, openDecision(text)?.text])
})
