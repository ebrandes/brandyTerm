import { test } from 'node:test'
import assert from 'node:assert/strict'
import { viewerThreadFiles } from './artifact-files.ts'

const threads = [
  { id: 'a', files: [{ path: 'src/x.ts', op: 'write' as const, at: '2026-01-01T00:00:01Z' }, { path: 'dist/x.js', op: 'write' as const, at: '2026-01-01T00:00:02Z' }] },
  { id: 'b', files: [{ path: 'src/x.ts', op: 'edit' as const, at: '2026-01-01T00:00:05Z' }, { path: 'src/y.ts', op: 'write' as const, at: '2026-01-01T00:00:04Z' }] },
  { id: 'c' }
]

test('viewerThreadFiles uses the given thread, without build output', () => {
  assert.deepEqual(viewerThreadFiles(threads, 'src/x.ts', 'a').map((f) => f.path), ['src/x.ts'])
})

test('viewerThreadFiles falls back to the thread that wrote the file last', () => {
  assert.deepEqual(viewerThreadFiles(threads, 'src/x.ts').map((f) => f.path), ['src/x.ts', 'src/y.ts'])
  assert.deepEqual(viewerThreadFiles(threads, 'src/x.ts', 'gone').map((f) => f.path), ['src/x.ts', 'src/y.ts'])
  assert.deepEqual(viewerThreadFiles(threads, 'README.md'), [])
  assert.deepEqual(viewerThreadFiles(threads, 'src/x.ts', 'c'), [])
})
