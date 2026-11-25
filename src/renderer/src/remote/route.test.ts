import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseId, remoteId, routeCall, splitIds } from './route.ts'
import { mergeStates } from './merge.ts'
import type { AppState, Project } from '../../../shared/types.ts'
import type { RemoteHostInfo } from '../../../shared/remote/machine.ts'

const proj = (id: string): Project => ({ id, name: id, threads: [], messages: [] } as unknown as Project)
const state = (ids: string[], machine?: AppState['machine']): AppState => ({ projects: ids.map(proj), agents: [], plugins: [], machine })
const host = (id: string, over: Partial<RemoteHostInfo> = {}): RemoteHostInfo => ({ machine: { id, name: id, os: 'mac' }, online: true, ...over })

test('parseId / remoteId round trip; plain id is local', () => {
  assert.deepEqual(parseId(remoteId('m1', 'p1')), { machineId: 'm1', projectId: 'p1' })
  assert.equal(parseId('p1').machineId, null)
  assert.deepEqual(parseId('@m1/a/b'), { machineId: 'm1', projectId: 'a/b' })
})

test('mergeStates keeps a local p1 and a remote p1 apart', () => {
  const m = mergeStates(state(['p1'], { id: 'me', name: 'me', os: 'linux' }), [{ info: host('m1'), state: state(['p1']) }])
  assert.deepEqual(m.projects.map(p => p.id), ['p1', '@m1/p1'])
  assert.equal(m.projects[0].machine?.remote, false)
  assert.equal(m.projects[1].machine?.remote, true)
})

test('mergeStates: offline host keeps last projects with online false and since; order follows hosts', () => {
  const m = mergeStates(state(['a']), [
    { info: host('m1', { online: false, since: '2026-11-25T10:00:00Z' }), state: state(['x']) },
    { info: host('m2'), state: state(['y']) },
    { info: host('m3') }
  ])
  assert.deepEqual(m.projects.map(p => p.id), ['a', '@m1/x', '@m2/y'])
  assert.equal(m.projects[1].machine?.online, false)
  assert.equal(m.projects[1].machine?.since, '2026-11-25T10:00:00Z')
})

test('routeCall restores the original id in each position', () => {
  assert.deepEqual(routeCall('chat:send', { projectId: '@m1/p1', text: 'oi' }), { machineId: 'm1', arg: { projectId: 'p1', text: 'oi' } })
  assert.equal(routeCall('chat:send', { projectId: 'p1', text: 'oi' }).machineId, null)
  assert.deepEqual(routeCall('commands:list', '@m1/p1'), { machineId: 'm1', arg: 'p1' })
  assert.deepEqual(routeCall('term:write', { id: '@m1/p1', data: 'x' }), { machineId: 'm1', arg: { id: 'p1', data: 'x' } })
  assert.deepEqual(routeCall('term:kill', '@m1/p1'), { machineId: 'm1', arg: 'p1' })
})

test('routeCall: non-string project id and unscoped channels stay local', () => {
  assert.equal(routeCall('chat:send', { projectId: 42 }).machineId, null)
  assert.equal(routeCall('chat:send', { projectId: ['@m1/p1'] }).machineId, null)
  assert.equal(routeCall('settings:set', { projectId: '@m1/p1' }).machineId, null)
})

test('splitIds groups by machine; non-strings stay local', () => {
  const g = splitIds(['a', '@m1/b', '@m1/c', 7])
  assert.deepEqual([...g], [[null, ['a', 7]], ['m1', ['b', 'c']]])
})
