import { test } from 'node:test'
import assert from 'node:assert/strict'
import { marketplaceOf, matchesPlugin, viewPlugins } from './plugin-list.ts'

const plugin = (n: number, on = false, market = 'oficial') => ({ id: `p${n}@${market}`, name: `plugin-${n}`, on })
const many = (count: number, onAt: number[] = []) => Array.from({ length: count }, (_, i) => plugin(i, onAt.includes(i)))
const names = (rows: { name: string }[]) => rows.map((r) => r.name)

test('marketplace comes from the id, project scope included', () => {
  assert.equal(marketplaceOf('caveman@claude-plugins'), 'claude-plugins')
  assert.equal(marketplaceOf('caveman@mkt#/Users/x/proj'), 'mkt')
  assert.equal(marketplaceOf('solto'), '')
})

test('search matches name or marketplace, ignoring case and accents', () => {
  const p = { id: 'revisão@Loja-Ação', name: 'Revisão', on: false }
  assert.equal(matchesPlugin(p, 'revisao'), true)
  assert.equal(matchesPlugin(p, 'ACAO'), true)
  assert.equal(matchesPlugin(p, 'outro'), false)
  assert.equal(matchesPlugin(p, '  '), true)
})

test('short lists show everything, without search or toggle', () => {
  const v = viewPlugins(many(8), '', false)
  assert.equal(v.rows.length, 8)
  assert.equal(v.searchable, false)
  assert.equal(v.canExpand, false)
  assert.equal(v.hidden, 0)
})

test('long lists show 8 rows, enabled first', () => {
  const v = viewPlugins(many(25, [20, 3]), '', false)
  assert.equal(v.searchable, true)
  assert.equal(v.rows.length, 8)
  assert.deepEqual(names(v.rows).slice(0, 3), ['plugin-3', 'plugin-20', 'plugin-0'])
  assert.equal(v.hidden, 17)
  assert.equal(v.matches, 25)
  assert.equal(v.canExpand, true)
})

test('enabled plugins are never cut by the limit', () => {
  const on = Array.from({ length: 10 }, (_, i) => i * 2)
  const v = viewPlugins(many(25, on), '', false)
  assert.equal(v.rows.length, 10)
  assert.ok(v.rows.every((r) => r.on))
  assert.equal(v.hidden, 15)
})

test('expanded shows all; searching shows every match and no toggle', () => {
  assert.equal(viewPlugins(many(25), '', true).rows.length, 25)
  const s = viewPlugins(many(25), 'plugin-1', false)
  assert.deepEqual(names(s.rows), ['plugin-1', ...Array.from({ length: 10 }, (_, i) => `plugin-1${i}`)])
  assert.equal(s.hidden, 0)
  assert.equal(s.canExpand, false)
  const none = viewPlugins(many(25), 'nada', false)
  assert.equal(none.matches, 0)
  assert.equal(none.searchable, true)
})
