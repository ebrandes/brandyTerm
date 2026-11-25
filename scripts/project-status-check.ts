// Checks the sidebar project status rule: node scripts/project-status-check.ts
import assert from 'node:assert/strict'
import type { Message, Thread } from '../src/shared/types.ts'
import { projectStatus, type StatusInput } from '../src/shared/project-status.ts'
import { mergeLastSeen, seedLastSeen } from '../src/main/last-seen.ts'

type T = StatusInput['threads'][number]
type M = NonNullable<StatusInput['messages']>[number]
const SEEN = '2026-11-25T10:00:00.000Z'
const before = '2026-11-25T09:00:00.000Z'
const after = '2026-11-25T11:00:00.000Z'
const t = (state: Thread['state'], updatedAt = after, extra: Partial<T> = {}): T => ({ state, updatedAt, ...extra })
const approval: Thread['approval'] = { id: 'a1', tool: 'Bash', summary: 'ls', createdAt: after }
const flags = (s: ReturnType<typeof projectStatus>) => [s.running, s.waiting, s.news]

// idle: no flag, no label
let s = projectStatus({ threads: [] })
assert.deepEqual(flags(s), [false, false, false])
assert.equal(s.label, '')
s = projectStatus({ threads: [t('done', before), t('failed', before)] }, { lastSeen: SEEN })
assert.deepEqual(flags(s), [false, false, false])
s = projectStatus({ threads: [t('queued'), t('cancelled'), t('interrupted')] }, { lastSeen: SEEN })
assert.deepEqual(flags(s), [false, false, false])

// running only: threads running, or the coordinator busy
s = projectStatus({ threads: [t('running'), t('running'), t('queued')] }, { lastSeen: SEEN })
assert.deepEqual(flags(s), [true, false, false])
assert.equal(s.runningCount, 2)
assert.equal(s.label, '2 executando')
s = projectStatus({ busy: true, threads: [] })
assert.deepEqual(flags(s), [true, false, false])
assert.equal(s.label, 'coordenador trabalhando')

// waiting: state waiting or a pending approval; independent of running
s = projectStatus({ threads: [t('waiting')] }, { selected: true })
assert.deepEqual(flags(s), [false, true, false])
s = projectStatus({ threads: [t('running', after, { approval })] }, { lastSeen: SEEN })
assert.deepEqual(flags(s), [false, true, false])
assert.equal(s.label, '1 aguardando você')

// running + waiting together
s = projectStatus({ threads: [t('running'), t('running'), t('waiting')] }, { lastSeen: SEEN })
assert.deepEqual(flags(s), [true, true, false])
assert.equal(s.label, '2 executando · 1 aguardando você')

// news: done/failed after lastSeen, hidden on the selected project and without lastSeen
s = projectStatus({ threads: [t('done'), t('done'), t('failed'), t('done', before)] }, { lastSeen: SEEN })
assert.deepEqual(flags(s), [false, false, true])
assert.deepEqual([s.done, s.failed], [2, 1])
assert.equal(s.label, '3 novidades')
assert.equal(projectStatus({ threads: [t('done')] }, { lastSeen: SEEN }).label, '1 novidade')
assert.equal(projectStatus({ threads: [t('done')] }, { lastSeen: SEEN, selected: true }).news, false)
assert.equal(projectStatus({ threads: [t('done')] }).news, false)
assert.equal(projectStatus({ threads: [t('done', SEEN)] }, { lastSeen: SEEN }).news, false)

// all three at once
s = projectStatus({ threads: [t('running'), t('waiting'), t('failed')] }, { lastSeen: SEEN })
assert.deepEqual(flags(s), [true, true, true])
assert.equal(s.label, '1 executando · 1 aguardando você · 1 novidade')

// coordinator messages after lastSeen are news too (a reply with no thread behind it)
const m = (author: Message['author'], time = after): M => ({ author, time })
s = projectStatus({ threads: [], messages: [m('user', before), m('coordinator')] }, { lastSeen: SEEN })
assert.deepEqual(flags(s), [false, false, true])
assert.equal(s.replies, 1)
assert.equal(s.label, '1 novidade')
assert.equal(projectStatus({ threads: [], messages: [m('coordinator', before), m('user'), m('system')] }, { lastSeen: SEEN }).news, false)
assert.equal(projectStatus({ threads: [], messages: [m('coordinator')] }, { lastSeen: SEEN, selected: true }).news, false)
assert.equal(projectStatus({ threads: [], messages: [m('coordinator')] }).news, false)

// exact case: leave the project, threads finish, the synthesis is posted -> news; open it -> no news
const at = (min: number) => new Date(Date.parse(SEEN) + min * 60_000).toISOString()
let seen = mergeLastSeen({}, { p: at(0) }) // leaving the project (useLastSeen cleanup)
const proj: StatusInput = { threads: [t('running', at(-1)), t('running', at(-1))], messages: [m('user', at(-2)), m('coordinator', at(-1))] }
assert.equal(projectStatus(proj, { lastSeen: seen.p }).news, false)
proj.threads = [t('done', at(5)), t('failed', at(6))] // threads end (engine sets updatedAt on settle)
proj.messages = [...proj.messages!, m('coordinator', at(7))] // synthesis posted
s = projectStatus(proj, { lastSeen: seen.p })
assert.deepEqual(flags(s), [false, false, true])
assert.deepEqual([s.done, s.failed, s.replies], [1, 1, 1])
assert.equal(projectStatus(proj, { lastSeen: seen.p, selected: true }).news, false) // user opens it
seen = mergeLastSeen(seen, { p: at(9) }) // opening records lastSeen
assert.equal(projectStatus(proj, { lastSeen: seen.p }).news, false) // and leaving again stays clean

// lastSeen persistence: merge only moves forward, seed fills new projects and drops removed ones
assert.deepEqual(mergeLastSeen({ a: SEEN }, { a: before, b: after, c: 'x', d: 3 }), { a: SEEN, b: after })
assert.deepEqual(mergeLastSeen({ a: SEEN }, { a: after }), { a: after })
assert.deepEqual(mergeLastSeen(undefined, null), {})
assert.deepEqual(seedLastSeen({ a: SEEN, gone: SEEN }, [{ id: 'a' }, { id: 'b' }], after), { a: SEEN, b: after })
assert.equal(seedLastSeen({ a: SEEN }, [{ id: 'a' }], after), null)

console.log('project-status-check: ok')
