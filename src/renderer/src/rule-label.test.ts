import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ruleLabel } from './rule-label.ts'

test('connector rules show the name and tool', () => {
  assert.equal(ruleLabel('Conector:railway:get_logs', { railway: 'Railway' }), 'Railway · get_logs')
  assert.equal(ruleLabel('Conector:railway:get_logs'), 'railway · get_logs')
  assert.equal(ruleLabel('Conector:a:b:c', { a: 'A' }), 'A · b:c')
})

test('other rules drop the Bash prefix only', () => {
  assert.equal(ruleLabel('Bash:npm test'), 'npm test')
  assert.equal(ruleLabel('Edits'), 'Edits')
})
