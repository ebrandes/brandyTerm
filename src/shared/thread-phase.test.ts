import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelLabel } from './thread-phase.ts'

test('the badge follows the phase', () => {
  const plan = { model: 'fable', effort: 'medium' as const }
  assert.equal(modelLabel({ model: 'opus' }), 'opus')
  assert.equal(modelLabel({}), '')
  assert.equal(modelLabel({ model: 'sonnet', plan }), 'plano · fable')
  assert.equal(modelLabel({ model: 'sonnet', plan: { ...plan, done: true, text: 'p' } }), 'sonnet · plano fable')
  // planning failed or answered by itself: no plan was handed over
  assert.equal(modelLabel({ model: 'opus', plan: { ...plan, done: true } }), 'opus')
})
