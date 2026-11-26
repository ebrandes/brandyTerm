import test from 'node:test'
import assert from 'node:assert/strict'
import { restoreProjects } from './restore.ts'
import type { Project, Thread } from '../shared/types.ts'

test('restoreProjects clears a report that was running when the app closed', () => {
  const t = { state: 'done', reporting: true, todos: [], steps: [], messages: [] } as unknown as Thread
  const p = { busy: true, messages: [], threads: [t] } as unknown as Project
  restoreProjects([p])
  assert.ok(!t.reporting)
  assert.equal(t.state, 'done')
})
