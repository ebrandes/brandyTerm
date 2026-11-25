import test from 'node:test'
import assert from 'node:assert/strict'
import { clock, groupProjects, groupTitle, lastSeenLabel, offlineLabel, roleLabel, secondsLeft, showGroups } from './machine-groups.ts'
import type { Project } from '../../shared/types.ts'
import type { RemoteHostInfo } from '../../shared/remote/machine.ts'

const proj = (id: string, machine?: Project['machine']) => ({ id, name: id, machine }) as unknown as Project
const me = { id: 'm1', name: 'MacBook-Pro', os: 'mac' as const }
const host = (id: string, online = true, since?: string): RemoteHostInfo => ({ machine: { id, name: id.toUpperCase(), os: 'windows' }, online, since })

test('offlineLabel formats local HH:MM', () => {
  const d = new Date(2026, 10, 25, 9, 5)
  assert.equal(offlineLabel(d.toISOString()), 'offline desde 09:05')
  assert.equal(offlineLabel(undefined), 'offline')
  assert.equal(offlineLabel('lixo'), 'offline')
})

test('groupTitle marks this machine', () => {
  assert.equal(groupTitle({ name: 'MacBook-Pro', local: true }), 'MacBook-Pro (este)')
  assert.equal(groupTitle({ name: 'PC-ESCRITORIO', local: false }), 'PC-ESCRITORIO')
})

test('groupProjects: local first, then hosts; empty hosts keep a group', () => {
  const projects = [
    proj('a', { ...me, remote: false, online: true }),
    proj('@pc/b', { id: 'pc', name: 'PC', os: 'windows', remote: true, online: true })
  ]
  const g = groupProjects(projects, [host('pc'), host('empty', false, '2026-01-01T10:00:00Z')], me)
  assert.deepEqual(g.map((x) => [x.id, x.projects.length, x.online]), [['m1', 1, true], ['pc', 1, true], ['empty', 0, false]])
  assert.equal(g[0].local, true)
  assert.equal(showGroups(g), true)
})

test('groupProjects: only this machine means no headers', () => {
  const g = groupProjects([proj('a', { ...me, remote: false, online: true })], [], me)
  assert.equal(g.length, 1)
  assert.equal(showGroups(g), false)
})

test('groupProjects: project of an unlisted machine gets its own group', () => {
  const g = groupProjects([proj('@x/a', { id: 'x', name: 'X', os: 'linux', remote: true, online: false, since: 's' })], [], me)
  assert.equal(g[1].id, 'x')
  assert.equal(g[1].local, false)
  assert.equal(g[1].online, false)
})

test('countdown math', () => {
  assert.equal(secondsLeft(120_000, 0), 120)
  assert.equal(secondsLeft(120_000, 500), 120)
  assert.equal(secondsLeft(120_000, 119_001), 1)
  assert.equal(secondsLeft(120_000, 130_000), 0)
  assert.equal(clock(120), '2:00')
  assert.equal(clock(65), '1:05')
  assert.equal(clock(-3), '0:00')
})

test('lastSeenLabel', () => {
  const now = new Date(2026, 10, 25, 12, 0)
  assert.equal(lastSeenLabel(new Date(2026, 10, 25, 8, 7).toISOString(), now), 'hoje 08:07')
  assert.equal(lastSeenLabel(new Date(2026, 10, 3, 8, 7).toISOString(), now), '03/11 08:07')
  assert.equal(lastSeenLabel(undefined, now), 'nunca conectou')
})

test('roleLabel', () => {
  assert.equal(roleLabel('client'), 'Controla esta máquina')
  assert.equal(roleLabel('host'), 'Esta máquina controla')
})
