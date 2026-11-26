import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeIn, isGlobal, scopePatch } from './connector-scope.ts'

test('a connector with no project list is active everywhere, unknown projects included', () => {
  for (const c of [{}, { projects: [] }, { exceptProjects: [] }]) {
    assert.equal(isGlobal(c), true)
    assert.equal(activeIn(c, '/a'), true)
    assert.equal(activeIn(c, '/brand-new'), true)
  }
})

test('a global connector is off only in its exceptions', () => {
  const c = { exceptProjects: ['/a'] }
  assert.equal(isGlobal(c), true)
  assert.equal(activeIn(c, '/a'), false)
  assert.equal(activeIn(c, '/new'), true)
})

test('a limited connector is on only in its projects', () => {
  const c = { projects: ['/a'], exceptProjects: ['/a'] }
  assert.equal(isGlobal(c), false)
  assert.equal(activeIn(c, '/a'), true)
  assert.equal(activeIn(c, '/b'), false)
})

test('making a connector global drops both lists', () => {
  assert.deepEqual(scopePatch({ projects: ['/a'] }, { global: true }), { projects: [], exceptProjects: [] })
})

test('turning one project off and on again, global and limited', () => {
  const cases: [Parameters<typeof scopePatch>[0], string, boolean, string[], string[]][] = [
    [{}, '/a', false, [], ['/a']],
    [{ exceptProjects: ['/a'] }, '/a', false, [], ['/a']],
    [{ exceptProjects: ['/a', '/b'] }, '/a', true, [], ['/b']],
    [{ projects: ['/a', '/b'] }, '/a', false, ['/b'], []],
    [{ projects: ['/b'] }, '/a', true, ['/b', '/a'], []]
  ]
  for (const [c, path, on, projects, exceptProjects] of cases) {
    const next = scopePatch(c, { path, on })
    assert.deepEqual(next, { projects, exceptProjects })
    assert.equal(activeIn(next!, path), on)
  }
})

// An empty project list means global, so removing the last one would turn it on everywhere.
test('the only project of a limited connector cannot be turned off by scope', () => {
  assert.equal(scopePatch({ projects: ['/a'] }, { path: '/a', on: false }), null)
})
