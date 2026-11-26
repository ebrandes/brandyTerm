import test from 'node:test'
import assert from 'node:assert/strict'
import type { Message, Project, Thread } from '../shared/types.ts'
import type { Engine } from './engine.ts'
import { RULES, ruleOf } from './rpc/channels.ts'
import { SCOPED } from '../shared/remote/scope.ts'
import { reportDirect } from './synthesis.ts'
import { reportThreadById, silentResult } from './thread-report-host.ts'
import type { RunResult } from './run.ts'

type Call = [Project, Thread, string, (() => void)?]

function fake(result: boolean) {
  const calls: Call[] = []
  const t = { id: 't1', title: 'T', agent: 'claude', state: 'done', resolved: true, summary: 'feito' } as Thread
  const p = { id: 'p1', messages: [] as Message[], threads: [t] } as unknown as Project
  const engine = {
    state: { projects: [p] },
    msg: (author: Message['author'], text: string, extra?: object) => ({ id: 'm', author, text, createdAt: '', ...extra }) as unknown as Message,
    touch() {},
    reporter: {
      report(pp: Project, tt: Thread, kind: string, onFail?: () => void) {
        calls.push([pp, tt, kind, onFail])
        return result
      }
    }
  } as unknown as Engine
  return { engine, p, t, calls }
}

test('reportDirect: resolved turn runs the short report instead of the old message', () => {
  const { engine, p, t, calls } = fake(true)
  reportDirect(engine, p, t)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][2], 'curto')
  assert.equal(p.messages.length, 0)
})

test('reportDirect: when the report fails the old message is posted', () => {
  const { engine, p, t, calls } = fake(true)
  reportDirect(engine, p, t)
  calls[0][3]!()
  assert.equal(p.messages.length, 1)
  assert.equal(p.messages[0].text, 'A thread “T” respondeu.')
  assert.equal(p.messages[0].summaries?.[0].text, 'feito')
})

test('reportDirect: report returning false posts the old message', () => {
  const { engine, p, t } = fake(false)
  reportDirect(engine, p, t)
  assert.equal(p.messages.length, 1)
  assert.equal(p.messages[0].text, 'A thread “T” respondeu.')
})

test('reportDirect: pending turn posts the old message without a report', () => {
  const { engine, p, t, calls } = fake(true)
  t.resolved = false
  reportDirect(engine, p, t)
  assert.equal(calls.length, 0)
  assert.equal(p.messages.length, 1)
})

test('reportDirect: failed turn posts the failure without a report', () => {
  const { engine, p, t, calls } = fake(true)
  t.state = 'failed'
  t.note = 'quebrou'
  reportDirect(engine, p, t)
  assert.equal(calls.length, 0)
  assert.equal(p.messages[0].text, 'A thread “T” falhou: quebrou')
  assert.equal(p.messages[0].isError, true)
})

test('reportThreadById: full report for a found thread, error otherwise', () => {
  const { engine, p, t, calls } = fake(true)
  reportThreadById(engine, 'p1', 't1')
  assert.deepEqual([calls[0][0], calls[0][1], calls[0][2]], [p, t, 'completo'])
  assert.throws(() => reportThreadById(engine, 'nope', 't1'))
  assert.throws(() => reportThreadById(engine, 'p1', 'nope'))
  assert.equal(calls.length, 1)
})

test('silentResult maps the run result', () => {
  const usage = { input: 0, output: 0, cached: 0, costUsd: 0 }
  const done = { kind: 'done', ok: true, text: 'oi' } as RunResult['done']
  assert.deepEqual(silentResult({ done, sessionId: 's', usage }), { ok: true, text: 'oi', error: undefined, sessionId: 's' })
  const bad = { kind: 'done', ok: false, text: '', error: 'x' } as RunResult['done']
  assert.equal(silentResult({ done: bad, usage }).error, 'x')
  assert.deepEqual(silentResult({ usage }), { ok: false, text: '', error: undefined, sessionId: undefined })
})

test('channel thread:report passes and is scoped by projectId', () => {
  assert.equal(RULES['thread:report'], 'pass')
  assert.equal(ruleOf('thread:report'), 'pass')
  assert.equal(SCOPED['thread:report'], 'projectId')
})
