import test from 'node:test'
import assert from 'node:assert/strict'
import type { Message, Project, Thread } from '../shared/types.ts'
import type { Engine } from './engine.ts'
import { maybeSynthesize, reportDirect } from './synthesis.ts'
import { reportThreadById } from './thread-report-host.ts'
import { ThreadReporter } from './thread-report.ts'
import { restoreProjects } from './restore.ts'
import { fakeHost, flush, project, thread } from './thread-report-fixture.ts'

function setup(t: Thread = thread({ summary: 'feito' })) {
  const f = fakeHost()
  const reporter = new ThreadReporter(f.host)
  const p = Object.assign(project(t), { synthesized: [] as string[], threads: [t], coordinator: {} })
  const jobs: (() => Promise<void>)[] = []
  const state = { coordinator: { plan: { reply: 'síntese', memory: [] } } as unknown }
  const engine = {
    state: { projects: [p] },
    reporter,
    msg: (author: Message['author'], text: string, extra?: object) =>
      ({ id: 'm', author, text, time: new Date().toISOString(), ...extra }) as Message,
    touch() {},
    fail() {},
    enqueue: (_p: Project, job: () => Promise<void>) => void jobs.push(job),
    askCoordinator: async () => state.coordinator
  } as unknown as Engine
  const cards = () => p.messages.flatMap((m) => m.summaries ?? []).length
  return { f, p, t, engine, jobs, state, cards }
}

test('repeated clicks post the summary once, while sending and after it was sent', async () => {
  const s = setup()
  reportThreadById(s.engine, 'p1', 't1')
  reportThreadById(s.engine, 'p1', 't1')
  assert.equal(s.f.runs.length, 1)
  s.f.runs[0].resolve({ ok: true, text: 'FEITO: x' })
  await flush()
  reportThreadById(s.engine, 'p1', 't1')
  assert.equal(s.f.runs.length, 1)
  assert.equal(s.cards(), 1)
})

test('a failed send keeps the error on the thread and can be retried', async () => {
  const s = setup()
  reportThreadById(s.engine, 'p1', 't1')
  s.f.runs[0].resolve({ ok: false, text: '', error: 'limite' })
  await flush()
  assert.equal(s.t.reportError, 'limite')
  assert.equal(s.t.reportedAt, undefined)
  reportThreadById(s.engine, 'p1', 't1')
  assert.equal(s.f.runs.length, 2)
  assert.equal(s.t.reportError, undefined)
  s.f.runs[1].resolve({ ok: true, text: 'FEITO: x' })
  await flush()
  assert.ok(s.t.reportedAt)
})

test('a click that cannot start throws instead of doing nothing', () => {
  const s = setup(thread({ sessionId: undefined }))
  assert.throws(() => reportThreadById(s.engine, 'p1', 't1'), /não foi possível enviar/i)
  assert.throws(() => reportThreadById(s.engine, 'p1', 'nope'), /não encontrada/i)
})

test('synthesis: sending while the coordinator writes, sent after, and a click adds nothing', async () => {
  for (const coordinator of [{ plan: { reply: 'síntese', memory: [] } }, { error: 'caiu' }]) {
    const s = setup()
    s.state.coordinator = coordinator
    maybeSynthesize(s.engine, s.p, 'r1')
    assert.equal(s.t.reporting, true)
    reportThreadById(s.engine, 'p1', 't1')
    await s.jobs[0]()
    assert.equal(s.t.reporting, undefined)
    assert.equal(s.t.reportedAt, s.p.messages[0].time)
    reportThreadById(s.engine, 'p1', 't1')
    assert.equal(s.f.runs.length, 0)
    assert.equal(s.cards(), 1)
  }
})

test('synthesis does not mark a thread that started a new turn meanwhile', async () => {
  const s = setup()
  maybeSynthesize(s.engine, s.p, 'r1')
  s.t.runAt = '2027-01-01T00:00:00.000Z'
  s.t.reporting = undefined
  await s.jobs[0]()
  assert.equal(s.t.reportedAt, undefined)
})

test('a synthesis that throws does not leave the thread stuck in sending', async () => {
  const s = setup()
  ;(s.engine as { askCoordinator: unknown }).askCoordinator = async () => {
    throw new Error('quebrou')
  }
  maybeSynthesize(s.engine, s.p, 'r1')
  await assert.rejects(s.jobs[0]())
  assert.equal(s.t.reporting, undefined)
  assert.equal(s.t.reportedAt, undefined)
})

test('reportDirect without a short report marks the thread only when it posts a summary card', () => {
  const sent = setup(thread({ summary: 'feito', resolved: false }))
  reportDirect(sent.engine, sent.p, sent.t)
  assert.ok(sent.t.reportedAt)
  const none = setup(thread({ resolved: false }))
  reportDirect(none.engine, none.p, none.t)
  assert.equal(none.t.reportedAt, undefined)
})

test('the mark survives reload, and old automatic summaries are recognised on load', () => {
  const summaries = [{ agent: 'claude' as const, title: 'T', text: 'x', threadId: 't1' }]
  const p = project(thread({ updatedAt: '2026-11-26T04:13:23.000Z' }))
  p.messages.push({ id: 'm', author: 'coordinator', time: '2026-11-26T04:13:33.000Z', text: 's', summaries })
  const loaded = JSON.parse(JSON.stringify([p])) as Project[]
  restoreProjects(loaded)
  assert.equal(loaded[0].threads[0].reportedAt, '2026-11-26T04:13:33.000Z')
})
