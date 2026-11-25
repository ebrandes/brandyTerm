import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addThreadFile, fileFromTool, filesFromCodex } from './artifact-files.ts'
import { applyThreadEvent } from './thread-events.ts'
import type { Project, Thread } from '../shared/types.ts'

const t1 = '2026-11-24T10:00:00.000Z'
const t2 = '2026-11-24T10:05:00.000Z'

test('fileFromTool maps Write/Edit tools to file ops', () => {
  assert.deepEqual(fileFromTool('Write', { file_path: '/p/a.md' }), { path: '/p/a.md', op: 'write' })
  assert.deepEqual(fileFromTool('Edit', { file_path: '/p/a.md' }), { path: '/p/a.md', op: 'edit' })
  assert.deepEqual(fileFromTool('MultiEdit', { file_path: '/p/a.md' }), { path: '/p/a.md', op: 'edit' })
  assert.deepEqual(fileFromTool('NotebookEdit', { notebook_path: '/p/n.ipynb' }), { path: '/p/n.ipynb', op: 'edit' })
  assert.equal(fileFromTool('Bash', { command: 'ls' }), null)
  assert.equal(fileFromTool('Write', {}), null)
  assert.equal(fileFromTool('Write', undefined), null)
})

test('filesFromCodex reads changes, skipping deletes', () => {
  const out = filesFromCodex({
    changes: [
      { path: '/p/x.md', kind: 'add' },
      { path: '/p/y.ts', kind: 'update' },
      { path: '/p/z', kind: 'delete' }
    ]
  })
  assert.deepEqual(out, [
    { path: '/p/x.md', op: 'write' },
    { path: '/p/y.ts', op: 'edit' }
  ])
  assert.deepEqual(filesFromCodex({}), [])
})

test('addThreadFile stores relative paths and dedups, last op wins', () => {
  let list = addThreadFile([], '/p', '/p/docs/a.md', 'write', t1)
  assert.deepEqual(list, [{ path: 'docs/a.md', op: 'write', at: t1 }])
  list = addThreadFile(list, '/p', '/p/b.md', 'write', t1)
  list = addThreadFile(list, '/p', '/p/docs/a.md', 'edit', t2)
  assert.deepEqual(list, [
    { path: 'b.md', op: 'write', at: t1 },
    { path: 'docs/a.md', op: 'edit', at: t2 }
  ])
})

test('addThreadFile ignores paths outside the root', () => {
  const list = [{ path: 'a.md', op: 'write' as const, at: t1 }]
  assert.equal(addThreadFile(list, '/p', '/etc/passwd', 'write', t2), list)
  assert.equal(addThreadFile(list, '/p', '/p/../q/a.md', 'write', t2), list)
  assert.equal(addThreadFile(list, '/p', '/p', 'write', t2), list)
})

test('addThreadFile keeps at most 50 files, dropping the oldest', () => {
  let list: ReturnType<typeof addThreadFile> = []
  for (let i = 0; i < 55; i++) list = addThreadFile(list, '/p', `/p/f${i}.md`, 'write', t1)
  assert.equal(list.length, 50)
  assert.equal(list[0].path, 'f5.md')
})

test('applyThreadEvent records files and ignores projects without a path', () => {
  const t = { steps: [], todos: [] } as unknown as Thread
  assert.equal(applyThreadEvent({} as Project, t, { kind: 'file', path: '/p/a.md', op: 'write' }), false)
  assert.equal(t.files, undefined)
  assert.equal(applyThreadEvent({ path: '/p' } as Project, t, { kind: 'file', path: '/p/a.md', op: 'write' }), true)
  assert.equal((t as Thread).files?.[0]?.path, "a.md")
})
