import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withHost } from './server-rig.ts'

test('renaming the machine announces the new name on the network; other changes do not', async () => {
  const log: string[] = []
  const publish = (info: { name: string; port: number; txt: Record<string, string> }) => {
    log.push(`publish ${info.name} ${info.txt.id}`)
    return { stop: () => { log.push(`stop ${info.name}`) } }
  }
  await withHost(async e => {
    assert.deepEqual(log, [`publish Host ${e.machine.id}`])
    e.bus.emit('change') // a project changed: same name, no new announcement
    assert.equal(log.length, 1)
    e.machine = { ...e.machine, name: 'Mac da sala' }
    e.bus.emit('change')
    assert.deepEqual(log.slice(1), ['stop Host', `publish Mac da sala ${e.machine.id}`])
  }, { publish })
  assert.equal(log.at(-1), 'stop Mac da sala', 'stopping the server withdraws the announcement')
})
