import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reportButtonState } from './thread-report-button.ts'
import type { Thread } from '../../../shared/types.ts'

const th = (extra: Partial<Thread> = {}) => ({ id: 'a', title: 'A', state: 'done', sessionId: 's', messages: [], updatedAt: '2026-11-25T11:00:00.000Z', ...extra }) as Thread
const msg = (author: string, time: string) => ({ id: time, author, time, text: 'x' })

test('hidden unless the thread is done and not retired', () => {
  assert.equal(reportButtonState(th({ state: 'running' })), 'hidden')
  assert.equal(reportButtonState(th({ retired: { reason: 'superseded' } } as Partial<Thread>)), 'hidden')
})

test('disabled when the thread never talked', () => {
  assert.equal(reportButtonState(th({ sessionId: undefined })), 'disabled')
})

test('busy while reporting', () => {
  assert.equal(reportButtonState(th({ reporting: true })), 'busy')
})

test('sent when reportedAt is newer than the last user message', () => {
  const messages = [msg('user', '2026-11-25T10:00:00.000Z'), msg('agent', '2026-11-25T10:30:00.000Z')] as Thread['messages']
  assert.equal(reportButtonState(th({ messages, reportedAt: '2026-11-25T10:45:00.000Z' })), 'sent')
  assert.equal(reportButtonState(th({ messages, reportedAt: '2026-11-25T09:00:00.000Z' })), 'ready')
})

test('sent with no user message when reportedAt exists; ready otherwise', () => {
  assert.equal(reportButtonState(th({ reportedAt: '2026-11-25T10:45:00.000Z' })), 'sent')
  assert.equal(reportButtonState(th()), 'ready')
})

test('compares instants, not strings', () => {
  const messages = [msg('user', '2026-11-25T10:00:00.000Z')] as Thread['messages']
  assert.equal(reportButtonState(th({ messages, reportedAt: '2026-11-25T08:00:00-03:00' })), 'sent')
})
