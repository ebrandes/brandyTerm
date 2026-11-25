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
      states: async () => [] as { machineId: string; state: AppState }[],
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

test('listArchived: a failing host contributes nothing and is reported; the local list stays', async () => {
  const f = fake(async () => { throw new Error('m1 está offline') })
  const errors: unknown[] = []
  const out = await createRoutedApi(f.api, () => {}, e => errors.push(e)).listArchived(['p1', '@m1/p1'])
  assert.deepEqual(out.map(a => a.projectId), ['p1'])
  assert.deepEqual(errors.map(e => (e as Error).message), ['m1 está offline'])
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

test('remote terminal: open rejects, write/resize/kill are not routed anywhere', async () => {
  const f = fake(async () => undefined)
  const touched: string[] = []
  ;(f.api.term as unknown as Record<string, unknown>) = {
    open: async () => { touched.push('open'); return true }, write: async () => { touched.push('write') },
    resize: async () => { touched.push('resize') }, kill: async () => { touched.push('kill') }
  }
  const api = createRoutedApi(f.api)
  await assert.rejects(api.term.open({ id: '@m1/p1', cols: 1, rows: 1 }), /Terminal remoto chega numa próxima versão/)
  await api.term.write({ id: '@m1/p1', data: 'x' })
  await api.term.resize({ id: '@m1/p1', cols: 1, rows: 1 })
  await api.term.kill('@m1/p1')
  assert.deepEqual(touched, [])
  assert.equal(f.calls.length, 0)
  assert.equal(await api.term.open({ id: 'p1', cols: 1, rows: 1 }), true)
  assert.deepEqual(touched, ['open'])
})

test('get() returns local plus the remote states main already holds, and drops hosts that vanish', async () => {
  const f = fake(async () => undefined)
  ;(f.api.remote as unknown as Record<string, unknown>).states = async () => [{ machineId: 'm1', state: { projects: [{ id: 'p9' }], agents: [], plugins: [] } }]
  const api = createRoutedApi(f.api)
  assert.deepEqual((await api.getState()).projects.map(p => p.id), ['p1', '@m1/p9'])
  f.setHosts([])
  f.listeners.hosts[0]([])
  assert.deepEqual((await api.getState()).projects.map(p => p.id), ['p1'])
})

test('an older getState snapshot does not overwrite a newer onState', async () => {
  const f = fake(async () => undefined)
  let release!: () => void
  f.api.getState = () => new Promise(r => { release = () => r({ projects: [{ id: 'old' }], agents: [], plugins: [] } as unknown as AppState) })
  const api = createRoutedApi(f.api)
  const p = api.getState()
  await new Promise(r => setImmediate(r))
  f.listeners.state[0]({ projects: [{ id: 'new' }], agents: [], plugins: [] } as unknown as AppState)
  release()
  assert.deepEqual((await p).projects.map(x => x.id), ['new'])
})
