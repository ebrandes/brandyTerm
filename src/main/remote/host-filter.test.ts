import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterState, projectOf } from './host-filter.ts'
import type { AppState, Project } from '../../shared/types.ts'

const proj = (id: string, over: Partial<Project> = {}) => ({ id, name: id, ...over }) as Project

function state(): AppState {
  return {
    projects: [proj('a'), proj('b', { remoteHidden: true })],
    agents: [], plugins: [],
    accounts: {
      list: [{ id: 'x', label: 'Conta', kind: 'token', token: 'sk-ant-xyz', error: 'boom' } as never],
      activeId: 'x', autoSwitch: true
    },
    settings: { keepAwake: true, lastSeen: { a: 'now' }, lastProjectId: 'a', remote: { enabled: true, port: 1 } }
  }
}

test('filterState drops hidden projects, secrets and local settings', () => {
  const out = filterState(state())
  assert.deepEqual(out.projects.map(p => p.id), ['a'])
  const json = JSON.stringify(out)
  assert.ok(!json.includes('sk-ant-xyz'))
  assert.equal(out.settings?.lastSeen, undefined)
  assert.equal(out.settings?.lastProjectId, undefined)
  assert.equal(out.settings?.keepAwake, true)
  assert.equal(out.accounts?.list[0].label, 'Conta')
})

test('filterState does not mutate its input', () => {
  const s = state()
  filterState(s)
  assert.equal(s.projects.length, 2)
  assert.ok(s.settings?.lastSeen)
})

test('projectOf', () => {
  assert.equal(projectOf('chat:send', { projectId: 'p1' }), 'p1')
  assert.equal(projectOf('commands:list', 'p2'), 'p2')
  assert.equal(projectOf('term:write', { id: 'p3', data: 'x' }), 'p3')
  assert.equal(projectOf('term:kill', 'p4'), 'p4')
  assert.equal(projectOf('archive:list', ['a']), null)
  assert.equal(projectOf('state:get', undefined), null)
})
