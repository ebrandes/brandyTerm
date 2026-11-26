import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scopeChoices } from './connector-scope-menu.ts'

const app = { name: 'app', path: '/p/app' }
const labels = (...a: Parameters<typeof scopeChoices>) => scopeChoices(...a).map(c => c.label)

test('a global connector can be turned off and on in the project in view', () => {
  assert.deepEqual(scopeChoices({}, app), [{ id: 'here', on: false, label: 'Desativar em app', patch: { projects: [], exceptProjects: ['/p/app'] } }])
  assert.deepEqual(scopeChoices({ exceptProjects: ['/p/app'] }, app), [{ id: 'here', on: true, label: 'Ativar em app', patch: { projects: [], exceptProjects: [] } }])
})

test('a limited connector can also be made global', () => {
  assert.deepEqual(labels({ projects: ['/p/site'] }, app), ['Ativar em todos os projetos', 'Ativar em app'])
  assert.deepEqual(labels({ projects: ['/p/site', '/p/app'] }, app), ['Ativar em todos os projetos', 'Desativar em app'])
})

test('no choice for the only project of a limited one, a folderless project or one on another machine', () => {
  assert.deepEqual(labels({ projects: ['/p/app'] }, app), ['Ativar em todos os projetos'])
  assert.deepEqual(labels({}, { name: 'demo', path: null }), [])
  assert.deepEqual(labels({}, { ...app, elsewhere: 'notebook' }), [])
  assert.deepEqual(labels({}, undefined), [])
})
