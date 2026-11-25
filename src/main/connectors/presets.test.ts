import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRESETS, presetById } from './presets.ts'

test('presets are well formed', () => {
  assert.equal(new Set(PRESETS.map(p => p.id)).size, PRESETS.length)
  for (const p of PRESETS) {
    if (p.transport === 'http') assert.ok(p.url?.startsWith('https://'), p.id)
    else assert.ok(p.command, p.id)
  }
  const r = presetById('railway')
  assert.equal(r?.auth.kind, 'cli')
  assert.equal(r?.command, 'railway')
  assert.equal(presetById('nope'), undefined)
})
