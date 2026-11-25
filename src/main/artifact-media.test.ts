import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findNewMedia, mediaType, parseRange } from './artifact-media.ts'

test('mediaType knows videos and images', () => {
  assert.equal(mediaType('a/b.mp4'), 'video/mp4')
  assert.equal(mediaType('x.MOV'), 'video/quicktime')
  assert.equal(mediaType('x.webm'), 'video/webm')
  assert.equal(mediaType('x.png'), 'image/png')
  assert.equal(mediaType('x.jpeg'), 'image/jpeg')
  assert.equal(mediaType('x.md'), null)
})

test('parseRange reads byte ranges for seeking', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 })
  assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 })
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 })
  assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 })
  assert.equal(parseRange(null, 1000), null)
  assert.equal(parseRange('bytes=2000-', 1000), 'invalid')
  assert.equal(parseRange('bytes=5-2', 1000), 'invalid')
  assert.equal(parseRange('items=0-1', 1000), 'invalid')
})

test('findNewMedia lists media changed since a time, skipping heavy and hidden folders', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'brandy-media-')))
  mkdirSync(join(root, 'out', 'videos'), { recursive: true })
  mkdirSync(join(root, 'node_modules', 'x'), { recursive: true })
  mkdirSync(join(root, '.cache'), { recursive: true })
  const since = Date.now() - 1000
  writeFileSync(join(root, 'out', 'videos', 'final.mp4'), 'v')
  writeFileSync(join(root, 'out', 'thumb.png'), 'i')
  writeFileSync(join(root, 'out', 'notes.md'), 'n')
  writeFileSync(join(root, 'node_modules', 'x', 'demo.mp4'), 'v')
  writeFileSync(join(root, '.cache', 'tmp.mp4'), 'v')
  writeFileSync(join(root, 'old.mp4'), 'v')
  const old = new Date(since - 60_000)
  utimesSync(join(root, 'old.mp4'), old, old)
  assert.deepEqual(findNewMedia(root, since).sort(), [join(root, 'out', 'thumb.png'), join(root, 'out', 'videos', 'final.mp4')])
})
