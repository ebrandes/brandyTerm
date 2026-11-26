import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dispatchReplies, retireReplaced, withNotes } from './plan-dispatch.ts'
import type { PlannedTask } from './coordinator.ts'
import type { Project, Thread } from '../shared/types.ts'

const th = (id: string, title: string, state: Thread['state']) => ({ id, title, state }) as Thread
const project = (threads: Thread[]) => ({ threads }) as Project

/** stands in for Engine.sendToThread: records what reached each thread */
function sender() {
  const sent: { threadId: string; text: string }[] = []
  return { sent, sendToThread: (_p: Project, threadId: string, text: string) => void sent.push({ threadId, text }) }
}

test('resume restarts an interrupted thread with the given text', () => {
  const p = project([th('a', 'Conector MCP Context7', 'interrupted'), th('b', 'Logs MCP', 'interrupted')])
  const s = sender()
  const r = dispatchReplies(s, p, { answers: [], resume: [{ threadTitle: 'Conector MCP Context7', text: 'Continue de onde parou.' }] })
  assert.deepEqual(s.sent, [{ threadId: 'a', text: 'Continue de onde parou.' }])
  assert.deepEqual(r.resumed, ['a'])
  assert.deepEqual(r.notes, [])
})

test('resume with an ambiguous title resumes nothing and says why', () => {
  const p = project([th('a', 'Corrigir MCP Context7', 'interrupted'), th('b', 'Corrigir MCP logs', 'interrupted')])
  const s = sender()
  const r = dispatchReplies(s, p, { answers: [], resume: [{ threadTitle: 'Corrigir MCP', text: 'siga' }] })
  assert.deepEqual(s.sent, [])
  assert.deepEqual(r.resumed, [])
  assert.equal(r.notes.length, 1)
  assert.match(r.notes[0], /ambíguo/)
  assert.match(r.notes[0], /Corrigir MCP Context7/)
  assert.match(r.notes[0], /Corrigir MCP logs/)
})

test('resume with an unknown title is reported', () => {
  const s = sender()
  const r = dispatchReplies(s, project([th('a', 'Outra', 'interrupted')]), { answers: [], resume: [{ threadTitle: 'Nada disso', text: 'siga' }] })
  assert.deepEqual(s.sent, [])
  assert.match(r.notes[0], /Nada disso/)
})

test('resume skips threads that are not interrupted, and retired ones', () => {
  const retired = { ...th('b', 'Logs MCP', 'interrupted'), retired: { reason: 'superseded', at: 'x' } } as Thread
  const p = project([th('a', 'Conector MCP', 'running'), retired])
  const s = sender()
  const r = dispatchReplies(s, p, { answers: [], resume: [{ threadTitle: 'Conector MCP', text: 'siga' }, { threadTitle: 'Logs MCP', text: 'siga' }] })
  assert.deepEqual(s.sent, [])
  assert.equal(r.notes.length, 2)
})

test('answers still reach only threads waiting for the user, by unique prefix too', () => {
  const p = project([th('a', 'Escolher banco de dados', 'waiting'), th('b', 'Escolher banco antigo', 'interrupted')])
  const s = sender()
  const r = dispatchReplies(s, p, { answers: [{ threadTitle: 'Escolher banco', text: 'Postgres' }], resume: [] })
  assert.deepEqual(s.sent, [{ threadId: 'a', text: 'Postgres' }])
  assert.deepEqual(r.notes, [])
})

const task = (title: string, replaces?: string): PlannedTask => ({ title, objective: 'o', agent: 'claude', effort: 'medium', replaces })

test('a task that replaces an interrupted thread marks the old one superseded, pointing to the new one', () => {
  const old = th('a', 'Logs MCP', 'interrupted')
  const fresh = th('n', 'Logs MCP v2', 'queued')
  const p = project([old, fresh])
  const notes = retireReplaced(p, [task('Logs MCP v2', 'Logs MCP')], [fresh])
  assert.deepEqual(notes, [])
  assert.equal(old.retired?.reason, 'superseded')
  assert.equal(old.retired?.by, 'n')
  assert.equal(old.retired?.byTitle, 'Logs MCP v2')
  assert.equal(old.state, 'interrupted')
  assert.match(old.note ?? '', /Logs MCP v2/)
})

test('replaces with an unknown title marks nothing and is reported', () => {
  const old = th('a', 'Logs MCP', 'interrupted')
  const fresh = th('n', 'Nova', 'queued')
  const notes = retireReplaced(project([old, fresh]), [task('Nova', 'Inexistente')], [fresh])
  assert.equal(old.retired, undefined)
  assert.match(notes[0], /Inexistente/)
})

test('notes are appended to the reply as a warning', () => {
  assert.equal(withNotes('Feito.', []), 'Feito.')
  assert.match(withNotes('Feito.', ['x', 'y']), /^Feito\.\n\n\*\*Aviso:\*\*[\s\S]*- x\n- y$/)
})
