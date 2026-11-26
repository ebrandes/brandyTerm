import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canRetire, retire, retiredLabel } from './thread-retire.ts'
import { projectStatus } from './project-status.ts'
import type { Thread } from './types.ts'

const th = (state: Thread['state'], extra: Partial<Thread> = {}) => ({ id: 'a', title: 'A', state, updatedAt: '2026-11-25T11:00:00.000Z', ...extra }) as Thread

test('retire marks a thread superseded by another, keeping its state', () => {
  const t = th('interrupted')
  retire(t, 'superseded', { id: 'n', title: 'Nova' })
  assert.equal(t.state, 'interrupted')
  assert.deepEqual({ ...t.retired, at: undefined }, { reason: 'superseded', by: 'n', byTitle: 'Nova', at: undefined })
  assert.equal(t.note, 'Substituída por “Nova”')
  assert.equal(retiredLabel(t), 'substituída')
})

test('retire marks a thread discarded by the user', () => {
  const t = th('failed')
  retire(t, 'discarded')
  assert.equal(retiredLabel(t), 'descartada')
  assert.equal(t.note, 'Descartada')
})

test('only finished threads that did not succeed can be set aside', () => {
  assert.ok(canRetire(th('interrupted')))
  assert.ok(canRetire(th('failed')))
  for (const s of ['running', 'queued', 'waiting', 'done', 'cancelled'] as const) assert.ok(!canRetire(th(s)), s)
  assert.ok(!canRetire(th('interrupted', { retired: { reason: 'discarded', at: 'x' } })))
})

test('a superseded or discarded thread is not counted in the project status', () => {
  const lastSeen = '2026-11-25T10:00:00.000Z'
  const failed = projectStatus({ threads: [th('failed')] }, { lastSeen })
  assert.equal(failed.failed, 1)
  for (const reason of ['superseded', 'discarded'] as const) {
    const s = projectStatus({ threads: [th('failed', { retired: { reason, at: 'x' } }), th('interrupted', { retired: { reason, at: 'x' } })] }, { lastSeen })
    assert.equal(s.failed, 0)
    assert.equal(s.news, false)
    assert.equal(s.waiting, false)
    assert.equal(s.label, '')
  }
})
