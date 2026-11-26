import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DetectedProc, ProcSnapshot } from '../shared/proc-attribution.ts'
import { checkStoppable, stopTree, taskkillArgs, type StopDeps } from './proc-stop.ts'

const APP = 100
const snapshot: ProcSnapshot = {
  procs: ([[50, 1], [APP, 50], [500, 1], [501, 500], [502, 501], [600, 1]] as const)
    .map(([pid, ppid]) => ({ pid, ppid, command: `c${pid}` })),
  ports: new Map()
}
const listed = (pid: number, o: Partial<DetectedProc> = {}): DetectedProc =>
  ({ pid, projectId: 'p', origin: 'external', command: `c${pid}`, ports: [], ...o })
const check = (pid: number, shown: DetectedProc[], fresh = shown) => checkStoppable({ pid, shown, fresh, appPid: APP, snapshot })

test('refuses a pid outside the shown list, a gone one and a reused one', () => {
  assert.equal(check(500, [listed(500)]), undefined)
  assert.match(check(600, [listed(500)])!, /não está na lista/)
  assert.match(check(600, [listed(500)], [listed(600)])!, /não está na lista/)
  assert.match(check(500, [listed(500)], [])!, /não está mais rodando/)
  assert.match(check(500, [listed(500)], [listed(500, { command: 'other' })])!, /outro processo/)
  assert.match(check(500, [listed(500, { startedAt: 1 })], [listed(500, { startedAt: 2 })])!, /outro processo/)
})

test('refuses the app, its ancestors and impossible pids, even when listed', () => {
  assert.match(check(APP, [listed(APP)])!, /próprio BrandyTerm/)
  assert.match(check(50, [listed(50)])!, /dentro deste processo/)
  for (const pid of [1, 0, -500, 1.5, Number.NaN]) assert.match(check(pid, [listed(pid)])!, /inválido/, String(pid))
})

/** processes that die on SIGTERM / plain taskkill unless they are `stubborn` */
function fake(platform: string, stubborn: number[] = [], immortal: number[] = []) {
  const live = new Set([50, APP, 500, 501, 502, 600])
  const log: string[] = []
  const end = (pid: number, force: boolean) => {
    if (!immortal.includes(pid) && (force || !stubborn.includes(pid))) live.delete(pid)
  }
  const deps: StopDeps = {
    platform, appPid: APP,
    kill: (pid, signal) => {
      log.push(`${signal} ${pid}`)
      if (immortal.includes(pid)) throw Object.assign(new Error('x'), { code: 'EPERM' })
      end(pid, signal === 'SIGKILL')
    },
    alive: (pid) => live.has(pid),
    run: async (file, args) => {
      log.push(`${file} ${args.join(' ')}`)
      const root = Number(args[1])
      const under: Record<number, number[]> = { 500: [502, 501, 500], 501: [502, 501], 502: [502] }
      for (const pid of under[root]) end(pid, args.includes('/F'))
    },
    sleep: async () => {}
  }
  return { deps, log, live }
}

test('unix: the whole tree gets SIGTERM, children first, and nothing else', async () => {
  const { deps, log, live } = fake('darwin')
  assert.deepEqual(await stopTree(500, snapshot, deps), { ok: true, forced: false })
  assert.deepEqual(log, ['SIGTERM 502', 'SIGTERM 501', 'SIGTERM 500'])
  assert.deepEqual([...live], [50, APP, 600])
})

test('unix: only who resists gets SIGKILL', async () => {
  const { deps, log } = fake('linux', [501])
  assert.deepEqual(await stopTree(500, snapshot, deps), { ok: true, forced: true })
  assert.deepEqual(log.slice(3), ['SIGKILL 501'])
})

test('unix: what survives is an error with the reason', async () => {
  const { deps } = fake('darwin', [], [501])
  assert.deepEqual(await stopTree(500, snapshot, deps), { ok: false, error: 'sem permissão (PID 501)' })
})

test('stopTree itself never signals the app or what it runs inside', async () => {
  for (const pid of [APP, 50, 1]) {
    const { deps, log } = fake('darwin')
    assert.equal((await stopTree(pid, snapshot, deps)).ok, false)
    assert.deepEqual(log, [])
  }
})

test('windows: taskkill /T, then /F only if something is left', async () => {
  assert.deepEqual(taskkillArgs(7, false), ['/PID', '7', '/T'])
  assert.deepEqual(taskkillArgs(7, true), ['/PID', '7', '/T', '/F'])
  const soft = fake('win32')
  assert.deepEqual(await stopTree(500, snapshot, soft.deps), { ok: true, forced: false })
  assert.deepEqual(soft.log, ['taskkill /PID 500 /T'])
  const hard = fake('win32', [500])
  assert.deepEqual(await stopTree(500, snapshot, hard.deps), { ok: true, forced: true })
  assert.deepEqual(hard.log, ['taskkill /PID 500 /T', 'taskkill /PID 500 /T /F'])
})
