import test from 'node:test'
import assert from 'node:assert/strict'
import type { Message, Project, Thread } from '../shared/types.ts'
import type { Engine } from './engine.ts'
import { runSlash } from './slash.ts'
import { ThreadReporter } from './thread-report.ts'
import { fakeHost, flush, project, thread } from './thread-report-fixture.ts'

/** an engine with a real reporter whose silent runs the test settles by hand */
function setup(extra: Partial<Thread> = {}) {
  const f = fakeHost()
  const reporter = new ThreadReporter(f.host)
  const e = {
    msg: (author: Message['author'], text: string, x?: Partial<Message>) => ({ id: 'm', author, text, time: '', ...x }) as Message,
    touch() {},
    reporter
  } as unknown as Engine
  const t = thread(extra)
  const p: Project = project(t)
  return { f, reporter, e, t, p }
}

const slash = (e: Engine, p: Project, t: Thread | undefined, name: string): void =>
  runSlash(e, p, { name, args: '' }, t, [])

test('/clear on a thread stops its silent run first; the late result does not bring the session back', async () => {
  const { f, reporter, e, t, p } = setup()
  assert.equal(reporter.report(p, t, 'curto'), true)
  slash(e, p, t, 'clear')
  assert.equal(f.runs[0].cancelled, true)
  assert.equal(reporter.busy(t.id), false)
  assert.equal(t.reporting, false)
  assert.equal(t.sessionId, undefined)
  f.runs[0].resolve({ ok: true, text: 'FEITO: x', sessionId: 's2' })
  await flush()
  assert.equal(t.sessionId, undefined)
  assert.equal(p.messages.length, 0)
  assert.equal(t.messages.at(-1)?.text, 'Contexto da thread limpo: a próxima mensagem começa uma sessão nova.')
})

test('/compact on a thread also stops its silent run', () => {
  const { f, reporter, e, t, p } = setup({ agent: 'codex' })
  reporter.report(p, t, 'completo')
  slash(e, p, t, 'compact')
  assert.equal(f.runs[0].cancelled, true)
  assert.equal(reporter.busy(t.id), false)
  assert.equal(t.messages.at(-1)?.text, 'O Codex já compacta sozinho ao passar do limite de contexto.')
})

test('/clear on a running thread is refused and leaves everything alone', () => {
  const { f, reporter, e, t, p } = setup({ state: 'running' })
  reporter.ask(p, t, 'Qual auth?')
  slash(e, p, t, 'clear')
  assert.equal(t.sessionId, 's1')
  assert.equal(f.runs.length, 0)
  assert.equal(t.messages.at(-1)?.text, 'A thread está executando; espere terminar.')
})
