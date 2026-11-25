import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alwaysLabel, covered, rulesFor } from './allow-rules.ts'

const c = (tool: string, id = 'railway') => ({ tool: `mcp__${id}__${tool}`, input: {}, connector: { id, name: id, tool } })

test('rulesFor and alwaysLabel for a connector ask', () => {
  assert.deepEqual(rulesFor(c('get_logs')), ['Conector:railway:get_logs'])
  assert.equal(alwaysLabel(c('get_logs')), 'Sempre nesta thread')
})

test('covered matches the exact connector tool only', () => {
  const rules = ['Conector:railway:get_logs']
  assert.equal(covered(rules, c('get_logs')), true)
  assert.equal(covered(rules, c('deploy')), false)
  assert.equal(covered(rules, c('get_logs', 'other')), false)
  assert.equal(covered(undefined, c('get_logs')), false)
})

test('non-connector asks keep their rules', () => {
  assert.deepEqual(rulesFor({ tool: 'Bash', input: { command: 'npm test && ls' } }), ['Bash:npm test'])
  assert.deepEqual(rulesFor({ tool: 'Write', input: {} }), ['Edits'])
  assert.equal(covered(['Edits'], { tool: 'Edit', input: {} }), true)
  assert.equal(alwaysLabel({ tool: 'Edit', input: {} }), 'Sempre editar arquivos nesta thread')
})
