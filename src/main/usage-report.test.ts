import { test } from 'node:test'
import assert from 'node:assert/strict'
import { corrections, escalated, qualityRow } from '../shared/thread-quality.ts'
import type { Message, Thread } from '../shared/types.ts'
import type { LedgerEntry } from '../shared/usage-report.ts'
import { compareSavers, verdictOf } from './usage-compare.ts'
import { buildReport } from './usage-build.ts'
import { rtkRow } from './rtk-gain.ts'

const msg = (author: Message['author'], text: string, extra: Partial<Message> = {}) =>
  ({ id: text, author, text, createdAt: '', ...extra }) as Message
const thread = (id: string, extra: Partial<Thread> = {}) => ({
  id, agent: 'claude', state: 'done', tier: 'leve', messages: [],
  usage: { input: 900, output: 100, cached: 5000, measured: true }, createdAt: '2026-11-25T12:00:00Z', ...extra
}) as unknown as Thread
const index = (list: Thread[]) => new Map(list.map((t) => [t.id, t]))

test('a correction is a message after a final answer; answers, plans, retries and commands are not', () => {
  const count = (...messages: Message[]) => corrections({ messages })
  assert.equal(count(msg('agent', 'feito'), msg('user', 'está errado'), msg('user', 'e mais isto')), 1)
  assert.equal(count(msg('agent', 'PERGUNTA: qual?'), msg('user', 'a primeira')), 0)
  assert.equal(count(msg('agent', 'plano', { plan: true }), msg('user', 'pode')), 0)
  assert.equal(count(msg('agent', 'feito'), msg('system', 'Falhou: x', { isError: true }), msg('user', 'de novo')), 0)
  assert.equal(count(msg('agent', 'feito'), msg('user', '/compact')), 0)
})

test('replacement by a higher tier is an escalation and the thread is not clean', () => {
  const old = thread('a', { state: 'failed', retired: { reason: 'superseded', by: 'b', at: '' } })
  const next = thread('b', { tier: 'padrao' })
  const byId = index([old, next])
  assert.equal(escalated(old, byId), true)
  assert.equal(escalated(next, byId), false)
  const row = qualityRow('todas', [old, next], byId)
  assert.deepEqual([row.finished, row.clean, row.cleanPct, row.replaced, row.escalations], [2, 1, 50, 1, 1])
  // what the failed attempt spent is part of the price of the delivered one
  assert.equal(row.tokensPerResolved, 2000)
})

const entry = (threadId: string, rtk: boolean, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
  ts: '2026-11-25T12:00:00Z', cwd: '/p/sub', kind: 'work', threadId, agent: 'claude', input: 10, output: 5, cached: 0,
  ok: true, rtk, te: false, ...extra
})

test('with × without leaves mixed threads out and flags small samples', () => {
  const list = ['a', 'b', 'c'].map((id) => thread(id))
  const entries = [entry('a', true), entry('b', false), entry('c', true), entry('c', false)]
  const [row, ...rest] = compareSavers(list, entries, index(list))
  assert.equal(rest.length, 0)
  assert.deepEqual([row.tool, row.with.finished, row.without.finished, row.enough], ['rtk', 1, 1, false])
})

test('gain needs less spend without worse quality, or better quality at equal spend', () => {
  const q = (tokensPerResolved: number, cleanPct: number, finished = 20) =>
    ({ ...qualityRow('todas', [], new Map()), finished, tokensPerResolved, cleanPct })
  assert.equal(verdictOf(q(800, 80), q(1000, 80), false).result, 'ganho')
  assert.equal(verdictOf(q(800, 60), q(1000, 80), false).result, 'sem-ganho')
  assert.equal(verdictOf(q(1000, 90), q(1000, 80), false).result, 'ganho')
  assert.equal(verdictOf(q(1300, 90), q(1000, 80), false).result, 'sem-ganho')
  assert.equal(verdictOf(q(800, 80, 3), q(1000, 80), true).result, 'insuficiente')
})

test('runs without a project id are named by their folder', () => {
  const report = buildReport({
    month: '2026-11', ledgerMonths: ['2026-11'], rtk: null,
    entries: [entry('t', true, { kind: 'router' }), entry('t', true, { cwd: '/tmp/scan', kind: 'scan' })],
    projects: [{ id: 'p', name: 'Projeto', path: '/p', threads: [thread('t')] }]
  })
  assert.deepEqual(report.usage.map((r) => r.project), ['fora de projetos', 'Projeto'])
  assert.equal(report.previous.month, '2026-10')
  assert.equal(report.verdict.result, 'insuficiente')
})

test('rtk days far above the median are listed apart', () => {
  const day = (date: string, saved: number) => ({ date, commands: 1, input_tokens: saved * 2, saved_tokens: saved })
  const json = JSON.stringify({ daily: [day('2026-10-31', 9), day('2026-11-01', 10), day('2026-11-02', 12), day('2026-11-03', 500)] })
  const row = rtkRow('p', json, '2026-11')!
  assert.deepEqual([row.saved, row.savedWithoutPeaks, row.peaks.length], [522, 22, 1])
  assert.equal(rtkRow('p', 'lixo', '2026-11'), null)
})
