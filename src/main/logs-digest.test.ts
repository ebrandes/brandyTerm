import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDigest, MAX_SUMMARY_CHARS } from './logs-digest.ts'
import type { LogEntry } from '../shared/logs.ts'

const at = (n: number): string => new Date(Date.UTC(2026, 10, 26, 10, 0, n)).toISOString()
const line = (n: number, level: LogEntry['level'], msg: string, data?: unknown): LogEntry =>
  ({ ts: at(n), level, msg, data })

test('errors come first, then warnings, then the rest from newest to oldest', () => {
  const out = buildDigest([
    line(1, 'error', 'erro antigo'), line(2, 'warn', 'aviso'),
    line(3, 'info', 'info velha'), line(4, 'info', 'info recente')
  ])
  const order = ['erro antigo', 'aviso', 'info recente', 'info velha'].map((m) => out.indexOf(m))
  assert.ok(order.every((i) => i >= 0))
  assert.deepEqual(order, [...order].sort((a, b) => a - b))
})

test('repeated lines become one with a count, even when only the duration differs', () => {
  const out = buildDigest(Array.from({ length: 50 }, (_, i) => line(i, 'info', 'tools/list ok', { connector: 'a', ms: i })))
  assert.equal(out.split('\n').length, 1)
  assert.match(out, /×50/)
})

test('lines about different connectors are not merged', () => {
  const out = buildDigest([line(1, 'info', 'conectando', { connector: 'a' }), line(2, 'info', 'conectando', { connector: 'b' })])
  assert.equal(out.split('\n').length, 2)
})

test('a huge log respects the ceiling, keeps the errors and only has whole lines', () => {
  const noise = Array.from({ length: 1000 }, (_, i) => line(i % 60, 'info', `linha ${i} ${'x'.repeat(180)} fim`))
  const out = buildDigest([line(0, 'error', 'quebrou'), ...noise])
  assert.equal(MAX_SUMMARY_CHARS, 18_000)
  assert.ok(out.length <= MAX_SUMMARY_CHARS, String(out.length))
  assert.ok(out.length > MAX_SUMMARY_CHARS - 400)
  assert.match(out.split('\n')[0], /quebrou/)
  for (const l of out.split('\n').slice(1)) assert.match(l, /fim$/)
})

test('a smaller ceiling is honoured, down to nothing', () => {
  const entries = [line(1, 'error', 'a'.repeat(100))]
  assert.equal(buildDigest(entries, 20), '')
})

test('one very long entry is clipped and does not eat the whole input', () => {
  const out = buildDigest([line(1, 'error', 'x '.repeat(5000)), line(2, 'error', 'outro erro')])
  assert.ok(out.length < 1500)
  assert.match(out, /outro erro/)
})

test('secrets are removed, also when they sit where a long line is cut', () => {
  const bearer = 'Bearer abcdef1234567890SEGREDO'
  const out = buildDigest([
    line(1, 'error', `falhou com ${bearer}`, { apiKey: 'valor-muito-secreto', note: 'ok' }),
    line(2, 'error', `${'y'.repeat(575)} ${bearer}`)
  ])
  assert.match(out, /Bearer \[oculto\]/)
  assert.doesNotMatch(out, /SEGREDO|abcdef|valor-muito-secreto/)
})
