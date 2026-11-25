import { test } from 'node:test'
import assert from 'node:assert/strict'
import { onlyElsewhere } from './elsewhere.ts'
import type { ConnectorView } from '../../../shared/connectors.ts'
import type { MachineInfo } from '../../../shared/remote/machine.ts'

const mac: MachineInfo = { id: 'm', name: 'Mac', os: 'mac' }
const pc: MachineInfo = { id: 'p', name: 'PC', os: 'windows' }
const local = [{ id: '1', name: 'Railway', preset: 'railway' }] as ConnectorView[]

test('lists what paired machines have and this one lacks, with the machines that have it', () => {
  const out = onlyElsewhere(local, [
    { machine: mac, list: [{ name: 'Railway', preset: 'railway' }, { name: 'Stripe', preset: 'stripe' }] },
    { machine: pc, list: [{ name: 'Stripe', preset: 'stripe' }] },
  ])
  assert.deepEqual(out, [{ name: 'Stripe', preset: 'stripe', machines: ['Mac', 'PC'] }])
})

test('names match case-insensitively', () => {
  const out = onlyElsewhere(local, [
    { machine: mac, list: [{ name: 'RAILWAY' }, { name: 'stripe' }] },
    { machine: pc, list: [{ name: 'Stripe', preset: 'stripe' }] },
  ])
  assert.deepEqual(out, [{ name: 'stripe', preset: 'stripe', machines: ['Mac', 'PC'] }])
})

test('nothing elsewhere gives an empty list', () => {
  assert.deepEqual(onlyElsewhere(local, [{ machine: mac, list: [{ name: 'railway' }] }]), [])
})
