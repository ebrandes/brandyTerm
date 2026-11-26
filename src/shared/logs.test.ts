import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterEntries, type LogEntry } from './logs.ts'

const entries: LogEntry[] = [
  { ts: '2026-11-26T10:00:00.000Z', level: 'info', msg: 'conectando', data: { connector: 'Context7' } },
  { ts: '2026-11-26T10:01:00.000Z', level: 'error', msg: 'Conexão falhou', data: { connector: 'Railway' } },
  { ts: '2026-11-26T10:02:00.000Z', level: 'warn', msg: 'lento' }
]
const msgs = (query: string, levels: LogEntry['level'][] = []) =>
  filterEntries(entries, { query, levels }).map((e) => e.msg)

test('no query and no level keeps everything', () => {
  assert.equal(msgs('').length, 3)
})

test('text search covers msg and data, ignoring case and accents', () => {
  assert.deepEqual(msgs('conexao'), ['Conexão falhou'])
  assert.deepEqual(msgs('context7'), ['conectando'])
  assert.deepEqual(msgs('nada disso'), [])
})

test('level filter combines with the text search', () => {
  assert.deepEqual(msgs('', ['error', 'warn']), ['Conexão falhou', 'lento'])
  assert.deepEqual(msgs('context7', ['error']), [])
})
