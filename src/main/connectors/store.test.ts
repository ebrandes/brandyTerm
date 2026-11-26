import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { ConnectorStore } from './store.ts'
import type { Connector } from '../../shared/connectors.ts'

function tmp(): string {
  return join(fs.mkdtempSync(join(os.tmpdir(), 'conn-')), 'connectors.json')
}

function draft(name: string, extra: Partial<Connector> = {}): Omit<Connector, 'id' | 'alwaysAllow'> {
  return { name, description: '', transport: 'stdio', command: 'x', auth: { kind: 'none' }, enabled: true, ...extra }
}

test('store adds, reads back after reload, updates, removes', () => {
  const file = tmp()
  const s = new ConnectorStore(file)
  const c = s.add(draft('Railway'))
  assert.ok(c.id)
  assert.deepEqual(c.alwaysAllow, [])
  const again = new ConnectorStore(file).list()
  assert.equal(again.length, 1)
  assert.equal(again[0].id, c.id)
  assert.equal(again[0].alwaysAllow.length, 0)
  s.remove(c.id)
  assert.equal(new ConnectorStore(file).list().length, 0)
})

test('store update patches fields, keeps the id and emits change', () => {
  const s = new ConnectorStore(tmp())
  const c = s.add(draft('Railway'))
  let changes = 0
  s.on('change', () => changes++)
  const u = s.update(c.id, { enabled: false, id: 'ignored' } as never)
  assert.equal(u.id, c.id)
  assert.equal(u.enabled, false)
  assert.equal(s.get(c.id)?.enabled, false)
  assert.equal(changes, 1)
  assert.throws(() => s.update('nope', { enabled: true }))
})

test('store rejects duplicate names', () => {
  const s = new ConnectorStore(tmp())
  s.add(draft('Railway'))
  assert.throws(() => s.add(draft('railway')), /Já existe um conector chamado Railway/)
})

test('store byName is case-insensitive', () => {
  const s = new ConnectorStore(tmp())
  const c = s.add(draft('Railway'))
  assert.equal(s.byName('RAILWAY')?.id, c.id)
  assert.equal(s.byName('other'), undefined)
})

test('store allow/revoke', () => {
  const s = new ConnectorStore(tmp())
  const c = s.add(draft('Railway'))
  s.allow(c.id, 'get_logs')
  s.allow(c.id, 'get_logs')
  assert.deepEqual(s.get(c.id)?.alwaysAllow, ['get_logs'])
  s.revoke(c.id, 'get_logs')
  assert.deepEqual(s.get(c.id)?.alwaysAllow, [])
})

test('visibleFor filters disabled and project-restricted', () => {
  const s = new ConnectorStore(tmp())
  s.add(draft('Off', { enabled: false }))
  const b = s.add(draft('Scoped', { projects: ['/a'] }))
  const c = s.add(draft('Open'))
  assert.deepEqual(s.visibleFor('/b').map(x => x.id), [c.id])
  assert.deepEqual(s.visibleFor('/a').map(x => x.id), [b.id, c.id])
})

test('store keeps a corrupt copy', () => {
  const file = tmp()
  fs.writeFileSync(file, '{not json')
  const prev = console.error
  console.error = () => {}
  let s: ConnectorStore
  try { s = new ConnectorStore(file) } finally { console.error = prev }
  assert.deepEqual(s.list(), [])
  const copy = fs.readdirSync(join(file, '..')).find(f => /^connectors\.json\.corrupt-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(f))
  assert.ok(copy)
  assert.equal(fs.readFileSync(join(file, '..', copy), 'utf8'), '{not json')
})

test('visibleFor offers a global connector everywhere but in its exceptions', () => {
  const s = new ConnectorStore(tmp())
  const c = s.add(draft('Docs', { exceptProjects: ['/a'] }))
  const empty = s.add(draft('Empty', { projects: [] }))
  assert.deepEqual(s.visibleFor('/a').map(x => x.id), [empty.id])
  assert.deepEqual(s.visibleFor('/brand-new').map(x => x.id), [c.id, empty.id])
})

test('switch and scope survive a restart', () => {
  const file = tmp()
  const s = new ConnectorStore(file)
  const global = s.add(draft('Docs'))
  const limited = s.add(draft('Scoped', { projects: ['/a'] }))
  const off = s.add(draft('Off'))
  s.update(global.id, { exceptProjects: ['/b'] })
  s.update(off.id, { enabled: false })
  const again = new ConnectorStore(file)
  assert.deepEqual(again.list().map(c => [c.enabled, c.projects, c.exceptProjects]), [
    [true, undefined, ['/b']], [true, ['/a'], undefined], [false, undefined, undefined]
  ])
  assert.deepEqual(again.visibleFor('/a').map(c => c.id), [global.id, limited.id])
  assert.deepEqual(again.visibleFor('/b').map(c => c.id), [])
  assert.equal(again.fault, undefined)
})

test('a damaged exception list is repaired, keeping the entry', () => {
  const file = tmp()
  fs.writeFileSync(file, JSON.stringify([{ ...draft('Docs'), id: '1', alwaysAllow: [], exceptProjects: ['/a', 7] }]))
  assert.deepEqual(new ConnectorStore(file).list()[0].exceptProjects, ['/a'])
})
