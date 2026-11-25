import { test } from 'node:test'
import assert from 'node:assert/strict'
import { elsewhere } from './elsewhere.ts'
import type { AppState } from '../../shared/types.ts'

const st = (machineName: string | undefined, names: string[]): AppState => ({
  projects: [], agents: [], plugins: [],
  ...(machineName ? { machine: { id: 'x', name: machineName, os: 'mac' as const } } : {}),
  connectors: { logins: [], list: names.map(name => ({ id: name, name, description: '', transport: 'stdio' as const, enabled: true, alwaysAllow: [], authKind: 'none' as const, status: 'desconectado' as const })) },
})
const host = (id: string, online: boolean) => ({ machine: { id, name: id, os: 'mac' as const }, online, address: '', })
const hosts = (list: ReturnType<typeof host>[], states: { machineId: string; state: AppState }[]) => ({ list: () => list, states: () => states })

test('finds the connector on an online host, by the name in its state', () => {
  const h = hosts([host('m1', true)], [{ machineId: 'm1', state: st('Mac', ['Railway']) }])
  assert.equal(elsewhere(h, 'railway'), 'Mac')
})

test('an offline host is ignored', () => {
  const h = hosts([host('m1', false)], [{ machineId: 'm1', state: st('Mac', ['Railway']) }])
  assert.equal(elsewhere(h, 'Railway'), undefined)
})

test('a state without a machine, a missing connector or no hosts gives undefined', () => {
  assert.equal(elsewhere(hosts([host('m1', true)], [{ machineId: 'm1', state: st(undefined, ['Railway']) }]), 'Railway'), undefined)
  assert.equal(elsewhere(hosts([host('m1', true)], [{ machineId: 'm1', state: st('Mac', ['Other']) }]), 'Railway'), undefined)
  assert.equal(elsewhere(undefined, 'Railway'), undefined)
})
