import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runThread, type RunHost } from './thread-run.ts'
import type { Message, Project, Thread } from '../shared/types.ts'
import type { RunOpts } from './adapters/types.ts'
import type { RunResult } from './run.ts'

const usage = { input: 10, output: 5, cached: 0, costUsd: 0 }
const ok = (text: string, sessionId: string): RunResult => ({ done: { kind: 'done', ok: true, text }, sessionId, usage })
const bad: RunResult = { done: { kind: 'done', ok: false, text: '', error: 'limite' }, usage }

function rig(results: (RunResult | Promise<RunResult>)[], over: Partial<Thread> = {}) {
  const p = { id: 'p', name: 'Demo', path: '/tmp/demo', messages: [], threads: [] } as unknown as Project
  const t = {
    id: 't', title: 'Login', agent: 'claude', objective: 'arrumar o login', model: 'sonnet', effort: 'medium', state: 'queued',
    plan: { model: 'fable', effort: 'medium' }, messages: [], todos: [], steps: [], usage: { input: 0, output: 0, cached: 0, measured: false }, ...over
  } as unknown as Thread
  const runs: RunOpts[] = []
  const finished: boolean[] = []
  const log: string[] = []
  const states: string[] = []
  const host: RunHost = {
    handles: new Map(),
    approvals: { ask: async () => 'deny', drop: () => {} } as unknown as RunHost['approvals'],
    pluginsFor: () => [],
    msg: (author, text, extra) => ({ id: String(Math.random()), author, text, time: '', ...extra }) as Message,
    touch: () => {},
    reporter: { cancel: () => log.push('reporter.cancel'), afterRun: () => log.push('reporter.afterRun') },
    finished: (_p, _t, direct) => (log.push('finished'), finished.push(direct)),
    pump: () => log.push('pump')
  }
  const start = (prompt: string, direct: boolean) =>
    runThread(host, p, t, prompt, direct, undefined, (_t, opts) => {
      runs.push(opts)
      states.push(t.state)
      return { handle: { done: Promise.resolve(), cancel() {} }, result: Promise.resolve(results.shift()!) }
    })
  const settle = () => new Promise((r) => setTimeout(r, 5))
  return { p, t, runs, finished, states, start, settle, log, host }
}

test('plan then execution: one stop, a fresh session, the plan shown and carried', async () => {
  const r = rig([ok('1. mexer em `a.ts`', 's-plan'), ok('**Resultado:** feito\nRESUMO: login corrigido', 's-exec')])
  r.start('PROMPT DE PLANO', false)
  await r.settle()
  assert.deepEqual(r.runs.map((o) => [o.model, o.tools, o.sessionId]), [['fable', 'readonly', undefined], ['sonnet', 'work', undefined]])
  assert.ok(r.runs[1].prompt.includes('1. mexer em `a.ts`'))
  assert.deepEqual(r.finished, [false])
  assert.deepEqual(r.states, ['running', 'running'])
  assert.deepEqual([r.t.state, r.t.sessionId, r.t.plan!.sessionId], ['done', 's-exec', 's-plan'])
  assert.deepEqual(r.t.messages.map((m) => [m.author, !!m.plan]), [['agent', true], ['agent', false]])
  assert.deepEqual([r.t.usage.input, r.t.plan!.usage!.input], [20, 10])
})

test('a plan question waits; the answer resumes the plan session and reports directly at the end', async () => {
  const r = rig([ok('PERGUNTA: qual banco?', 's-plan'), ok('1. usar postgres', 's-plan'), ok('RESUMO: feito', 's-exec')])
  r.start('PROMPT DE PLANO', false)
  await r.settle()
  assert.deepEqual([r.t.state, r.finished.length, r.p.messages.length], ['waiting', 1, 1])
  r.start('postgres', true)
  await r.settle()
  assert.deepEqual(r.runs.map((o) => [o.model, o.tools, o.sessionId]), [['fable', 'readonly', undefined], ['fable', 'readonly', 's-plan'], ['sonnet', 'work', undefined]])
  assert.deepEqual(r.finished, [false, true])
  assert.equal(r.t.state, 'done')
})

test('a plan that answers ends the thread without execution', async () => {
  const r = rig([ok('**Resultado:** nada a mudar\nRESUMO: já estava certo', 's-plan')])
  r.start('PROMPT DE PLANO', false)
  await r.settle()
  assert.deepEqual([r.runs.length, r.t.state, r.t.summary, r.t.plan!.done], [1, 'done', 'já estava certo', true])
})

test('a failed plan runs once on opus alone; if that fails too the thread fails', async () => {
  const r = rig([bad, bad])
  r.start('PROMPT DE PLANO', false)
  await r.settle()
  assert.deepEqual(r.runs.map((o) => [o.model, o.effort, o.tools]), [['fable', 'medium', 'readonly'], ['opus', 'high', 'work']])
  assert.ok(!r.runs[1].prompt.includes('Plano (feito por outro modelo'))
  assert.deepEqual([r.t.state, r.finished.length], ['failed', 1])
  assert.match(r.t.messages[0].text, /Plano indisponível \(limite\)/)
})

test('a thread without a plan runs as before', async () => {
  const r = rig([ok('RESUMO: ok', 's1')], { plan: undefined, model: 'opus', effort: 'high' })
  r.start('PROMPT', false)
  await r.settle()
  assert.deepEqual(r.runs.map((o) => [o.model, o.effort, o.tools]), [['opus', 'high', 'work']])
  assert.equal(r.t.state, 'done')
})

test('a run stops the silent report first; a queued question and the queue run after the stop, not between phases', async () => {
  const r = rig([ok('1. mexer em `a.ts`', 's-plan'), ok('RESUMO: feito', 's-exec')])
  r.start('PROMPT DE PLANO', false)
  assert.deepEqual(r.log, ['reporter.cancel'])
  await r.settle()
  assert.deepEqual(r.log.filter((x) => x !== 'reporter.cancel'), ['finished', 'reporter.afterRun', 'pump'])
})

test('a planning run cancelled from outside (project removed, app quitting) does not fall back to opus', async () => {
  const r = rig([bad])
  r.start('PROMPT DE PLANO', false)
  r.host.handles.get('t')!.cancel()
  await r.settle()
  assert.equal(r.runs.length, 1)
  assert.deepEqual([r.t.plan!.done, r.t.model], [undefined, 'sonnet'])
})

test('the end of a run that was replaced leaves the new run alone', async () => {
  let endOld!: (r: RunResult) => void
  const r = rig([new Promise<RunResult>((res) => (endOld = res)), new Promise<RunResult>(() => {})])
  r.start('PROMPT DE PLANO', false)
  r.t.state = 'cancelled'
  r.start('de novo', true)
  const current = r.host.handles.get('t')
  endOld(bad)
  await r.settle()
  assert.equal(r.runs.length, 2)
  assert.equal(r.host.handles.get('t'), current)
  assert.deepEqual([r.t.state, r.finished.length], ['running', 0])
})

test('a new turn clears the sent mark, even one left by the cancelled short report', async () => {
  const r = rig([ok('RESUMO: feito', 's')], { plan: undefined, reporting: true, reportError: 'limite' })
  r.host.reporter.cancel = () => void (r.t.reportedAt = '2026-11-25T10:00:00.000Z')
  r.start('de novo', true)
  assert.deepEqual([r.t.reportedAt, r.t.reportError, r.t.reporting], [undefined, undefined, undefined])
  await r.settle()
})
