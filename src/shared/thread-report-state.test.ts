import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backfillSent, markSent, summarySent } from './thread-report-state.ts'
import type { Message, Project, Thread } from './types.ts'

const at = (h: number) => `2026-11-25T${String(h).padStart(2, '0')}:00:00.000Z`
const user = (h: number) => ({ id: `u${h}`, author: 'user', time: at(h), text: 'x' }) as Message
const auto = (h: number, threadId = 'a') =>
  ({ id: `m${h}`, author: 'coordinator', time: at(h), text: 'síntese', summaries: [{ agent: 'claude', title: 'A', text: 'ok', threadId }] }) as Message
const th = (extra: Partial<Thread> = {}) => ({ id: 'a', state: 'done', messages: [user(8)], updatedAt: at(10), ...extra }) as Thread
const proj = (t: Thread, messages: Message[]) => ({ threads: [t], messages }) as unknown as Project

test('summarySent: only a mark newer than the last user message counts', () => {
  assert.equal(summarySent(th()), false)
  assert.equal(summarySent(th({ reportedAt: at(9) })), true)
  assert.equal(summarySent(th({ reportedAt: at(7) })), false)
})

test('markSent stores the time and clears an old error', () => {
  const t = th({ reportError: 'limite' })
  markSent(t, at(11))
  assert.equal(t.reportedAt, at(11))
  assert.equal(t.reportError, undefined)
})

test('backfill: a summary the system already posted for the last turn marks the thread, once', () => {
  const t = th()
  const p = proj(t, [auto(11), auto(12)])
  backfillSent(p)
  assert.equal(t.reportedAt, at(12))
  backfillSent(p)
  assert.equal(t.reportedAt, at(12))
})

test('backfill ignores older turns, other threads, unfinished threads and existing marks', () => {
  for (const [t, m] of [
    [th(), auto(9)],
    [th(), auto(11, 'b')],
    [th({ state: 'failed' }), auto(11)],
    [th({ messages: [user(12)] }), auto(11)]
  ] as const) {
    backfillSent(proj(t, [m]))
    assert.equal(t.reportedAt, undefined)
  }
  const marked = th({ reportedAt: at(13) })
  backfillSent(proj(marked, [auto(11)]))
  assert.equal(marked.reportedAt, at(13))
})
