import { test } from 'node:test'
import assert from 'node:assert/strict'
import { approve, cancel, enqueue, nextAction, retry, settle, visibleItems, waitingLabel, IDLE_WINDOW_MS, SETTLE_MS } from './apply-queue.ts'
import type { ApplyItem, ApplyStatus } from './apply-queue.ts'

const item = (id: string, status: ApplyStatus = 'approval', over: Partial<ApplyItem> = {}): ApplyItem => ({
  id, projectId: 'p', title: id, worktree: `/wt/${id}`, branch: id, base: 'b', head: 'h', files: [], status,
  createdAt: '2026-11-26T12:00:00Z', ...over
})
const NOW = 1_000_000
const quiet = { idleSince: NOW - IDLE_WINDOW_MS, lastApplyAt: null, bootAt: NOW - SETTLE_MS }
const statuses = (l: ApplyItem[]) => l.map((i) => `${i.id}:${i.status}`)

test('enqueue keeps order; a new request of the same worktree replaces the old one', () => {
  let l = enqueue(enqueue([], item('a', 'pending')), item('b'))
  l = enqueue(l, item('a2', 'approval', { worktree: '/wt/a' }))
  assert.deepEqual(statuses(l), ['b:approval', 'a2:approval'])
})

test('enqueue refuses a worktree being applied', () => {
  assert.throws(() => enqueue([item('a', 'applying')], item('z', 'approval', { worktree: '/wt/a' })), /sendo aplicada/)
})

test('approve, retry and cancel act only on the right status', () => {
  assert.equal(approve([item('a')], 'a')[0].status, 'pending')
  assert.equal(approve([item('a', 'applied')], 'a')[0].status, 'applied')
  const again = retry([item('a', 'failed', { error: 'x' })], 'a')[0]
  assert.deepEqual([again.status, again.error], ['pending', undefined])
  assert.equal(cancel([item('a', 'pending')], 'a')[0].status, 'cancelled')
  assert.equal(cancel([item('a', 'applying')], 'a')[0].status, 'applying')
  assert.deepEqual(cancel([item('a', 'applied')], 'a'), [])
})

test('only the last five finished items are kept', () => {
  let l = Array.from({ length: 7 }, (_, n) => item(`d${n}`, 'applied'))
  l = settle([...l, item('x', 'applying')], 'x', { status: 'applied' })
  assert.deepEqual(l.map((i) => i.id), ['d3', 'd4', 'd5', 'd6', 'x'])
  assert.deepEqual(visibleItems([item('c', 'cancelled'), item('a')]).map((i) => i.id), ['a'])
})

test('applies the first approved item once idle long enough', () => {
  const l = [item('u'), item('a', 'pending'), item('b', 'pending')]
  assert.deepEqual(nextAction(l, 0, NOW, quiet), { apply: 'a' })
})

test('never applies while something runs, whatever the queue', () => {
  assert.deepEqual(nextAction([item('a', 'pending')], 1, NOW, { ...quiet, idleSince: null }), { wait: 'running' })
  assert.deepEqual(nextAction([item('a', 'pending')], 2, NOW, quiet), { wait: 'running' })
})

test('waits for the idle window, the boot and the previous apply to settle', () => {
  const l = [item('a', 'pending')]
  for (const t of [{ idleSince: NOW - IDLE_WINDOW_MS + 1 }, { bootAt: NOW - SETTLE_MS + 1 }, { lastApplyAt: NOW - SETTLE_MS + 1 }])
    assert.deepEqual(nextAction(l, 0, NOW, { ...quiet, ...t }), { wait: 'settling' })
  assert.deepEqual(nextAction(l, 0, NOW, { ...quiet, lastApplyAt: NOW - SETTLE_MS }), { apply: 'a' })
})

test('one at a time; a failed item holds the queue until retried or discarded', () => {
  assert.deepEqual(nextAction([item('a', 'applying'), item('b', 'pending')], 0, NOW, quiet), { wait: 'applying' })
  const l = [item('a', 'failed'), item('b', 'pending')]
  assert.deepEqual(nextAction(l, 0, NOW, quiet), { wait: 'failed' })
  assert.deepEqual(nextAction(cancel(l, 'a'), 0, NOW, quiet), { apply: 'b' })
  assert.deepEqual(nextAction(retry(l, 'a'), 0, NOW, quiet), { apply: 'a' })
  assert.deepEqual(nextAction([item('u')], 0, NOW, quiet), { wait: 'empty' })
})

test('waiting label', () => {
  assert.equal(waitingLabel(3), 'aguardando threads terminarem (3 rodando)')
  assert.equal(waitingLabel(0), 'aplicando em instantes')
})
