// Checks the thread retention rule: node scripts/archive-check.ts
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import type { Project, Thread } from '../src/shared/types.ts'
import { KEEP_RECENT, archiveProjects, listArchived, readArchive, reopenArchived, selectToArchive } from '../src/main/archive.ts'

const NOW = Date.parse('2026-11-24T12:00:00Z')
const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()

function thread(id: string, state: Thread['state'], ageDays: number, extra: Partial<Thread> = {}): Thread {
  const at = iso(NOW - ageDays * DAY)
  return {
    id, requestId: `r-${id}`, title: id, objective: id, agent: 'claude', effort: 'medium', state, todos: [], steps: [], messages: [],
    usage: { input: 10, output: 5, cached: 0, measured: true }, createdAt: at, updatedAt: at, ...extra
  }
}

function project(id: string, threads: Thread[]): Project {
  return {
    id, name: id, path: '/tmp', demo: false, messages: [], threads, busy: false, synthesized: [], processes: [],
    coordinator: { usage: { input: 0, output: 0, cached: 0, measured: false } }
  }
}

const ids = (ts: Thread[]) => ts.map((t) => t.id).sort()
let ok = 0
const check = (name: string, fn: () => void) => {
  fn()
  ok++
  console.log('ok -', name)
}

check('7-day rule: only old finished threads; active, queued, waiting and pending stay', () => {
  const p = project('a', [
    thread('done-old', 'done', 8, { resolved: true }),
    thread('failed-old', 'failed', 9),
    thread('cancel-old', 'cancelled', 30),
    thread('interrupted-old', 'interrupted', 10),
    thread('done-new', 'done', 2, { resolved: true }),
    thread('pending-old', 'done', 20, { pending: 'falta X' }),
    thread('running-old', 'running', 20),
    thread('queued-old', 'queued', 20),
    thread('waiting-old', 'waiting', 20)
  ])
  assert.deepEqual(ids(selectToArchive(p, NOW)), ['cancel-old', 'done-old', 'failed-old', 'interrupted-old'])
})

check('50-per-project rule: finished threads past the 50 most recent go, even if recent', () => {
  const ts = Array.from({ length: 60 }, (_, i) => thread(`t${i}`, 'done', i * 0.05, { resolved: true }))
  ts[55] = thread('t55', 'running', 55 * 0.05)
  const p = project('b', ts)
  const out = ids(selectToArchive(p, NOW))
  assert.equal(out.length, 60 - KEEP_RECENT - 1)
  assert.ok(!out.includes('t55'), 'running thread never archived')
  assert.ok(out.every((id) => Number(id.slice(1)) >= KEEP_RECENT))
})

check('a request with a thread still running keeps its finished siblings', () => {
  const p = project('c', [thread('old', 'done', 9, { requestId: 'r1' }), thread('live', 'running', 9, { requestId: 'r1' })])
  assert.deepEqual(selectToArchive(p, NOW), [])
})

check('recently reopened thread is not archived again right away', () => {
  const p = project('d', [thread('back', 'done', 30, { restoredAt: iso(NOW - DAY) })])
  assert.deepEqual(selectToArchive(p, NOW), [])
})

check('demo projects are never archived', () => {
  const p = { ...project('e', [thread('x', 'done', 30)]), demo: true }
  assert.deepEqual(selectToArchive(p, NOW), [])
})

check('migration moves to disk atomically, is idempotent and reopen works', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brandy-archive-'))
  try {
    const p = project('f', [thread('old1', 'done', 8), thread('old2', 'failed', 12), thread('new', 'done', 1), thread('run', 'running', 40)])
    assert.equal(archiveProjects([p], dir, NOW), 2)
    assert.deepEqual(ids(p.threads), ['new', 'run'])
    assert.deepEqual(ids(readArchive(dir, 'f')), ['old1', 'old2'])
    assert.equal(p.archived?.count, 2)
    assert.equal(p.archived?.usage.input, 20)
    assert.deepEqual(readdirSync(dir), ['f.json'], 'no temp file left behind')

    // second run: nothing moves, archive unchanged
    assert.equal(archiveProjects([p], dir, NOW), 0)
    assert.deepEqual(ids(readArchive(dir, 'f')), ['old1', 'old2'])

    // crash between archive write and state save: thread in both places -> merged by id, no duplicate
    const crashed = project('f', [...p.threads, thread('old1', 'done', 8)])
    assert.equal(archiveProjects([crashed], dir, NOW), 1)
    assert.deepEqual(ids(readArchive(dir, 'f')), ['old1', 'old2'])

    // listing and reopening
    assert.deepEqual(listArchived(dir, [p]).map((a) => a.id), ['old1', 'old2'])
    const t = reopenArchived(dir, p, 'old2', new Date(NOW))
    assert.equal(t?.id, 'old2')
    assert.ok(p.threads.some((x) => x.id === 'old2'))
    assert.equal(p.archived?.count, 1)
    assert.deepEqual(listArchived(dir, [p]).map((a) => a.id), ['old1'])
    assert.equal(archiveProjects([p], dir, NOW), 0, 'reopened thread stays for now')
    assert.equal(reopenArchived(dir, p, 'nope'), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

console.log(`${ok} checks passed`)
