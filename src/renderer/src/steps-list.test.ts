// Guards the "N ações" list of the run panel (Chat.tsx RunPanel, .steps in styles.css).
// Bug: the list is a flex column capped by max-height, and each item has overflow: hidden,
// so its automatic min-height is 0. With many actions (main keeps up to 60) the items were
// shrunk to under 1px each instead of scrolling: the group opened with only the tree line.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** Declarations of the rule whose selector is exactly `selector`, as a property map. */
function rule(selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  assert.ok(m, `rule ${selector} not found in styles.css`)
  const decls = new Map<string, string>()
  for (const d of m[1].split(';')) {
    const i = d.indexOf(':')
    if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim())
  }
  return decls
}

/** True when a flex item with these declarations never shrinks below its content. */
function keepsHeight(item: Map<string, string>): boolean {
  if (item.get('flex-shrink') === '0') return true
  const flex = item.get('flex')
  return flex === 'none' || /^\S+\s+0(\s|$)/.test(flex ?? '')
}

test('the actions list scrolls instead of squeezing its items', () => {
  const list = rule('.steps ul')
  const item = rule('.steps li')
  const capped = list.has('max-height') && list.get('display') === 'flex' && list.get('flex-direction') === 'column'
  assert.ok(capped, 'premise: the list is a flex column with a max-height')
  assert.equal(item.get('overflow'), 'hidden', 'premise: items clip their text (min-height becomes 0)')
  assert.ok(keepsHeight(item), '.steps li must not shrink (flex: none), or 60 actions collapse to <1px each')
  assert.match(list.get('overflow-y') ?? '', /auto|scroll/, 'the extra actions scroll inside the list')
})

test('keepsHeight reads the flex shorthands', () => {
  const d = (s: string) => new Map(s.split(';').filter(Boolean).map((x) => x.split(':').map((y) => y.trim()) as [string, string]))
  assert.equal(keepsHeight(d('flex: none')), true)
  assert.equal(keepsHeight(d('flex-shrink: 0')), true)
  assert.equal(keepsHeight(d('flex: 1 0 auto')), true)
  assert.equal(keepsHeight(d('flex: 1')), false)
  assert.equal(keepsHeight(d('color: red')), false)
})
