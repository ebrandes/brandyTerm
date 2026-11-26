import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reportButtonState, reportButtonView } from './thread-report-button.ts'
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

test('error after a failed report, until it is sent or being retried', () => {
  assert.equal(reportButtonState(th({ reportError: 'limite' })), 'error')
  assert.equal(reportButtonState(th({ reportError: 'limite', reporting: true })), 'busy')
  assert.equal(reportButtonState(th({ reportError: 'limite', reportedAt: '2026-11-25T10:45:00.000Z' })), 'sent')
})

test('a click shows sending at once and cannot be repeated', () => {
  const view = reportButtonView(th(), { pending: true })
  assert.deepEqual([view.label, view.inactive], ['Enviando…', true])
})

test('sent: inactive, with the time in the tooltip', () => {
  const view = reportButtonView(th({ reportedAt: '2026-11-25T10:45:00.000Z' }))
  assert.deepEqual([view.label, view.inactive], ['Enviado ao coordenador ✓', true])
  const time = new Date('2026-11-25T10:45:00.000Z').toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  assert.ok(view.title?.includes(time))
})

test('a refused click shows the error without the IPC prefix and allows a retry', () => {
  const failed = reportButtonView(th(), { error: "Error invoking remote method 'thread:report': Error: A thread está ocupada." })
  assert.deepEqual([failed.label, failed.inactive, failed.error], ['Tentar novamente', false, 'Não foi enviado: A thread está ocupada.'])
  assert.equal(reportButtonView(th({ reportError: 'limite' })).error, 'Não foi enviado: limite')
  assert.equal(reportButtonView(th({ reportedAt: '2026-11-25T10:45:00.000Z' }), { error: 'x' }).error, undefined)
})
