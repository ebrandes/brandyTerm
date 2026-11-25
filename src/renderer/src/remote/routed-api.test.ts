import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoutedApi } from './routed-api.ts'
import type { BrandyApi } from '../../../shared/api.ts'
import type { AppState, ArchivedThreadInfo } from '../../../shared/types.ts'
import type { RemoteHostInfo } from '../../../shared/remote/machine.ts'

type Call = { machineId: string; channel: string; arg: unknown }
const arch = (projectId: string, updatedAt: string) => ({ projectId, id: 't', updatedAt }) as ArchivedThreadInfo

function fake(remoteCall: (c: Call) => Promise<unknown>) {
  const calls: Call[] = []
  const localCalls: unknown[] = []
  const listeners = { state: [] as ((s: AppState) => void)[], rstate: [] as ((e: { machineId: string; state: AppState }) => void)[], hosts: [] as ((h: RemoteHostInfo[]) => void)[] }
  let hosts: RemoteHostInfo[] = [{ machine: { id: 'm1', name: 'm1', os: 'mac' }, online: true }]
  const api = {
    platform: 'linux',
    getState: async () => ({ projects: [{ id: 'p1' }], agents: [], plugins: [] }) as unknown as AppState,
    onState: (cb: (s: AppState) => void) => { listeners.state.push(cb); return () => {} },
    listArchived: async (ids: string[]) => { localCalls.push(ids); return [arch('p1', '2026-01-02')] },
    send: async (a: unknown) => { localCalls.push(a) },
    term: {},
    remote: {
      hosts: async () => hosts,
      onHosts: (cb: (h: RemoteHostInfo[]) => void) => { listeners.hosts.push(cb); return () => {} },
      onState: (cb: (e: { machineId: string; state: AppState }) => void) => { listeners.rstate.push(cb); return () => {} },
      call: (c: Call) => { calls.push(c); return remoteCall(c) }
    }
  } as unknown as BrandyApi
  return { api, calls, localCalls, listeners, setHosts: (h: RemoteHostInfo[]) => { hosts = h } }
}

test('listArchived splits ids, merges results, namespaces remote ids', async () => {
  const f = fake(async () => [arch('p1', '2026-01-03')])
  const out = await createRoutedApi(f.api).listArchived(['p1', '@m1/p1'])
  assert.deepEqual(f.localCalls, [['p1']])
  assert.deepEqual(f.calls, [{ machineId: 'm1', channel: 'archive:list', arg: ['p1'] }])
  assert.deepEqual(out.map(a => a.projectId), ['@m1/p1', 'p1'])
})

test('listArchived: a failing host contributes nothing', async () => {
  const f = fake(async () => { throw new Error('m1 está offline') })
  const out = await createRoutedApi(f.api).listArchived(['p1', '@m1/p1'])
  assert.deepEqual(out.map(a => a.projectId), ['p1'])
})

test('a remote call goes through remote.call with the original id; local stays local', async () => {
  const f = fake(async () => undefined)
  const api = createRoutedApi(f.api)
  await api.send({ projectId: '@m1/p1', text: 'oi' })
  await api.send({ projectId: 'p1', text: 'oi' })
  await api.send({ projectId: 9 as unknown as string, text: 'oi' })
  assert.deepEqual(f.calls, [{ machineId: 'm1', channel: 'chat:send', arg: { projectId: 'p1', text: 'oi' } }])
  assert.equal(f.localCalls.length, 2)
})

test('a call to an offline host rejects with the main process error', async () => {
  const f = fake(async () => { throw new Error('Mac está offline') })
  await assert.rejects(createRoutedApi(f.api).send({ projectId: '@m1/p1', text: 'x' }), /Mac está offline/)
})

test('onState is notified with the merged state on remote state and hosts events', async () => {
  const f = fake(async () => undefined)
  const api = createRoutedApi(f.api)
  await new Promise(r => setImmediate(r)) // initial hosts() resolves
  const seen: string[][] = []
  api.onState(s => seen.push(s.projects.map(p => p.id)))
  f.listeners.state[0]({ projects: [{ id: 'p1' }], agents: [], plugins: [] } as unknown as AppState)
  f.listeners.rstate[0]({ machineId: 'm1', state: { projects: [{ id: 'p1' }], agents: [], plugins: [] } as unknown as AppState })
  assert.deepEqual(seen.at(-1), ['p1', '@m1/p1'])
  f.listeners.hosts[0]([])
  assert.deepEqual(seen.at(-1), ['p1'])
})
