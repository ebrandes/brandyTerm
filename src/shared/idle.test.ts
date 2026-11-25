import { test } from 'node:test'
import assert from 'node:assert/strict'
import { idleCompactDue, shouldStayAwake, DEFAULT_IDLE_COMPACT } from './idle.ts'
import type { Project, Thread } from './types.ts'

const T0 = Date.parse('2026-11-25T12:00:00Z')
const minsAgo = (m: number) => new Date(T0 - m * 60_000).toISOString()

function proj(over: Partial<Project> = {}, t: Partial<Thread>[] = []): Project {
  return {
    id: 'p', name: 'p', path: '/x', demo: false,
    messages: [{ id: 'm', author: 'user', time: minsAgo(10), text: 'oi' }],
    threads: t as Thread[],
    coordinator: { agent: 'claude', sessionId: 's', usage: { input: 0, output: 0, cached: 0, measured: false }, context: { used: 50_000, limit: 300_000 } },
    busy: false, synthesized: [], processes: [],
    ...over
  } as Project
}

test('shouldStayAwake: busy project or running/queued thread', () => {
  assert.equal(shouldStayAwake([proj({ busy: true })]), true)
  assert.equal(shouldStayAwake([proj({}, [{ state: 'running' }])]), true)
  assert.equal(shouldStayAwake([proj({}, [{ state: 'queued' }])]), true)
  assert.equal(shouldStayAwake([proj({}, [{ state: 'done' }])]), false)
  assert.equal(shouldStayAwake([]), false)
})

test('shouldStayAwake: a dev server alone does not keep awake', () => {
  const p = proj({ processes: [{ id: 'd', name: 'dev', command: 'npm run dev', state: 'running' } as never] })
  assert.equal(shouldStayAwake([p]), false)
})

test('idleCompactDue: due when idle long enough with enough context', () => {
  assert.equal(idleCompactDue(proj(), T0, DEFAULT_IDLE_COMPACT), true)
})

test('idleCompactDue: each blocking condition stops it', () => {
  const cases: [string, Project][] = [
    ['codex agent', proj({ coordinator: { agent: 'codex', sessionId: 's', usage: {} as never, context: { used: 50_000, limit: 1 } } })],
    ['no session', proj({ coordinator: { agent: 'claude', usage: {} as never, context: { used: 50_000, limit: 1 } } })],
    ['busy', proj({ busy: true })],
    ['thread queued', proj({}, [{ state: 'queued' }])],
    ['context below min', proj({ coordinator: { agent: 'claude', sessionId: 's', usage: {} as never, context: { used: 1000, limit: 1 } } })],
    ['activity too recent', proj({ messages: [{ id: 'm', author: 'user', time: minsAgo(1), text: 'x' }] })],
  ]
  for (const [name, p] of cases) assert.equal(idleCompactDue(p, T0, DEFAULT_IDLE_COMPACT), false, name)
})

test('idleCompactDue: not again after compaction past the last activity', () => {
  const p = proj()
  p.coordinator.compactedAt = minsAgo(5)
  assert.equal(idleCompactDue(p, T0, DEFAULT_IDLE_COMPACT), false)
  p.coordinator.compactedAt = minsAgo(20)
  assert.equal(idleCompactDue(p, T0, DEFAULT_IDLE_COMPACT), true)
})

test('idleCompactDue: disabled config', () => {
  assert.equal(idleCompactDue(proj(), T0, { ...DEFAULT_IDLE_COMPACT, enabled: false }), false)
})
