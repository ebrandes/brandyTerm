import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claudeStream } from './claude-events.ts'
import type { AgentEvent } from './types.ts'

const call = (id: string, name: string, file_path: string) => ({ type: 'assistant', message: { id: 'm' + id, content: [{ type: 'tool_use', id, name, input: { file_path } }] } })
const result = (id: string, is_error = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error }] } })

test('a file card is emitted only after the Write/Edit call succeeded', () => {
  const events: AgentEvent[] = []
  const s = claudeStream((e) => events.push(e), 'acc')
  s.handle(call('1', 'Write', '/p/ok.md'))
  s.handle(call('2', 'Write', '/p/denied.md'))
  assert.equal(events.filter((e) => e.kind === 'file').length, 0)
  s.handle(result('1'))
  s.handle(result('2', true))
  assert.deepEqual(events.filter((e) => e.kind === 'file'), [{ kind: 'file', path: '/p/ok.md', op: 'write' }])
})
