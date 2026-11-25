import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampWidth, edgeDistance, maxWidthFor, readWidth, widenKey, writeWidth } from './panel-size.ts'
import type { KeyStore } from './side-state.ts'

const memory = (): KeyStore & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

test('clamp rounds into [min, max]', () => {
  assert.equal(clampWidth(100, 232, 380), 232)
  assert.equal(clampWidth(500, 232, 380), 380)
  assert.equal(clampWidth(300.6, 232, 380), 301)
})

test('max width: window share for the right panel, fixed cap for the sidebar', () => {
  assert.equal(maxWidthFor(1400, 280, 0.5), 700)
  assert.equal(maxWidthFor(400, 280, 0.5), 280)
  assert.equal(maxWidthFor(1400, 232, undefined, 380), 380)
  assert.equal(maxWidthFor(600, 232, 0.5, 380), 300)
  assert.equal(maxWidthFor(1400, 232), 232)
})

test('width round-trips under its own key; broken or odd storage falls back', () => {
  const s = memory()
  assert.equal(readWidth(s, 'brandy:sidebar-width', 272), 272)
  writeWidth(s, 'brandy:sidebar-width', 300)
  assert.equal(readWidth(s, 'brandy:sidebar-width', 272), 300)
  assert.equal(readWidth(s, 'brandy:overview-width', 420), 420)
  s.setItem('k', 'abc')
  assert.equal(readWidth(s, 'k', 272), 272)
  s.setItem('k', '-5')
  assert.equal(readWidth(s, 'k', 272), 272)
  const broken: KeyStore = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('full')
    }
  }
  assert.equal(readWidth(broken, 'k', 272), 272)
  assert.doesNotThrow(() => writeWidth(broken, 'k', 300))
  assert.equal(readWidth(undefined, 'k', 272), 272)
})

test('pointer distance and widening key follow the docked edge', () => {
  assert.equal(edgeDistance('left', 300, 1400), 300)
  assert.equal(edgeDistance('right', 1000, 1400), 400)
  assert.equal(widenKey('left'), 'ArrowRight')
  assert.equal(widenKey('right'), 'ArrowLeft')
})
