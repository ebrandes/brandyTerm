import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchThread } from './thread-match.ts'
import type { Thread } from '../shared/types.ts'

const th = (id: string, title: string, state: Thread['state'] = 'interrupted') => ({ id, title, state }) as Thread
const interrupted = (t: Thread) => t.state === 'interrupted'

test('matches the exact title, ignoring case and extra spaces', () => {
  const threads = [th('a', 'Conector MCP Context7'), th('b', 'Logs de diagnóstico')]
  const m = matchThread(threads, '  conector mcp   context7 ', interrupted)
  assert.ok('thread' in m && m.thread.id === 'a')
})

test('accepts a unique prefix, with or without an ellipsis', () => {
  const threads = [th('a', 'Conector MCP Context7 dando timeout (-32001)'), th('b', 'Logs de diagnóstico para conectores')]
  for (const given of ['Logs de diagnóstico', 'Logs de diagnóstico para conec…', 'Logs de diagnóstico...']) {
    const m = matchThread(threads, given, interrupted)
    assert.ok('thread' in m && m.thread.id === 'b', given)
  }
})

test('accepts the long title the coordinator proposed when the stored one was cut', () => {
  const stored = 'Logs de diagnóstico para conectores MCP, plugins, skills e a'
  const m = matchThread([th('a', stored)], `${stored}cesso remoto`, interrupted)
  assert.ok('thread' in m && m.thread.id === 'a')
})

test('an ambiguous prefix names every candidate and picks none', () => {
  const threads = [th('a', 'Corrigir MCP Context7'), th('b', 'Corrigir MCP logs')]
  const m = matchThread(threads, 'Corrigir MCP', interrupted)
  assert.ok('error' in m)
  assert.equal(m.error, 'ambiguous')
  assert.deepEqual(m.candidates.map((t) => t.id), ['a', 'b'])
})

test('two threads with the same exact title are ambiguous', () => {
  const m = matchThread([th('a', 'Corrigir MCP'), th('b', 'Corrigir MCP')], 'Corrigir MCP', interrupted)
  assert.ok('error' in m && m.error === 'ambiguous')
})

test('an exact title wins over a longer title that shares the prefix', () => {
  const m = matchThread([th('a', 'Corrigir MCP'), th('b', 'Corrigir MCP logs')], 'corrigir mcp', interrupted)
  assert.ok('thread' in m && m.thread.id === 'a')
})

test('threads outside the accepted states never match', () => {
  const m = matchThread([th('a', 'Corrigir MCP', 'running')], 'Corrigir MCP', interrupted)
  assert.ok('error' in m && m.error === 'missing')
})

test('a prefix too short to identify anything is missing, not a guess', () => {
  const m = matchThread([th('a', 'Corrigir MCP')], 'Co', interrupted)
  assert.ok('error' in m && m.error === 'missing')
})
