import { test } from 'node:test'
import assert from 'node:assert/strict'
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { remoteCalls } from './remote-calls.ts'
import { MAX_ARTIFACT } from '../artifact-read.ts'
import { MAX_ATTACHMENT } from '../attachment-scope.ts'
import { authorize, HIDDEN } from './host-filter.ts'
import { SCOPED, UNSCOPED } from '../../shared/remote/scope.ts'
import type { AppState, Project } from '../../shared/types.ts'

function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'rc-')))
  const att = join(base, 'att')
  const proj = join(base, 'proj')
  mkdirSync(join(att, 'p1'), { recursive: true })
  mkdirSync(join(att, 'p2'), { recursive: true })
  mkdirSync(join(proj, 'sub'), { recursive: true })
  const added: string[] = []
  const c = remoteCalls({
    engine: { addProject: p => { added.push(p); return 'id1' } },
    attachmentsRoot: () => att,
    rootOf: id => (id === 'p1' ? proj : null),
    home: () => base
  })
  return { base, att, proj, added, c }
}

test('attach:read returns the project own attachment', () => {
  const { att, c } = setup()
  writeFileSync(join(att, 'p1', 'a.png'), Buffer.from([1, 2, 3]))
  const r = c.attachRead({ projectId: 'p1', path: join(att, 'p1', 'a.png') })
  assert.equal(r.name, 'a.png')
  assert.equal(r.mime, 'image/png')
  assert.deepEqual([...r.data], [1, 2, 3])
})

test('attach:read rejects ../ escapes, other projects and symlinks out', () => {
  const { base, att, c } = setup()
  writeFileSync(join(base, 'secret'), 'x')
  writeFileSync(join(att, 'p2', 'o.txt'), 'x')
  symlinkSync(join(base, 'secret'), join(att, 'p1', 'link'))
  assert.throws(() => c.attachRead({ projectId: 'p1', path: join(att, 'p1', '..', '..', 'secret') }), /não encontrado/)
  assert.throws(() => c.attachRead({ projectId: 'p1', path: join(att, 'p2', 'o.txt') }), /não encontrado/)
  assert.throws(() => c.attachRead({ projectId: 'p1', path: join(att, 'p1', 'link') }), /não encontrado/)
  assert.throws(() => c.attachRead({ projectId: 'p1', path: join(att, 'p1') }), /não encontrado/)
})

test('attach:read rejects over MAX_ATTACHMENT', () => {
  const { att, c } = setup()
  const f = join(att, 'p1', 'big.bin')
  writeFileSync(f, '')
  // sparse file: the size is what counts
  const fd = openSync(f, 'r+')
  ftruncateSync(fd, MAX_ATTACHMENT + 1)
  closeSync(fd)
  assert.throws(() => c.attachRead({ projectId: 'p1', path: f }), /grande demais/)
})

test('artifact:bytes reads a project file and rejects symlinks out, unknown project, ../ and big files', () => {
  const { base, proj, c } = setup()
  writeFileSync(join(proj, 'sub', 'a.md'), '# oi')
  writeFileSync(join(base, 'outside.md'), 'x')
  symlinkSync(join(base, 'outside.md'), join(proj, 'link.md'))
  const ok = c.artifactBytes({ projectId: 'p1', path: 'sub/a.md' })
  assert.equal(ok.mime, 'text/markdown')
  assert.equal(new TextDecoder().decode(ok.data), '# oi')
  assert.throws(() => c.artifactBytes({ projectId: 'p1', path: 'link.md' }), /não encontrado/)
  assert.throws(() => c.artifactBytes({ projectId: 'p1', path: '../outside.md' }), /não encontrado/)
  assert.throws(() => c.artifactBytes({ projectId: 'nope', path: 'sub/a.md' }), /não encontrado/)
  writeFileSync(join(proj, 'big.txt'), Buffer.alloc(MAX_ARTIFACT + 1))
  assert.throws(() => c.artifactBytes({ projectId: 'p1', path: 'big.txt' }), /grande demais/)
})

test('project:add-path adds a folder (expanding ~), rejects a file or a missing path', () => {
  const { base, proj, added, c } = setup()
  writeFileSync(join(base, 'f.txt'), 'x')
  assert.equal(c.addPath(proj), 'id1')
  assert.equal(c.addPath('~/proj'), 'id1')
  assert.deepEqual(added, [proj, proj])
  assert.throws(() => c.addPath(join(base, 'f.txt')), /^Error: Não é uma pasta$/)
  assert.throws(() => c.addPath(join(base, 'missing')), /Não é uma pasta/)
  assert.throws(() => c.addPath(''), /Não é uma pasta/)
})

test('fs:browse lists folders only', async () => {
  const { base, c } = setup()
  writeFileSync(join(base, 'f.txt'), 'x')
  const r = await c.browse(`${base}/`)
  assert.deepEqual(r.map(e => e.path.slice(base.length + 1)), ['att/', 'proj/'])
  assert.ok(r.every(e => e.kind === 'dir'))
  assert.ok(!r.some(e => e.path.endsWith('f.txt')))
})

test('new channels are classified; a hidden project attach:read is refused', () => {
  assert.equal(SCOPED['attach:read'], 'projectId')
  assert.equal(SCOPED['artifact:bytes'], 'projectId')
  assert.ok(UNSCOPED.has('fs:browse') && UNSCOPED.has('project:add-path') && UNSCOPED.has('remote:open-bytes'))
  const s = { projects: [{ id: 'a' }, { id: 'b', remoteHidden: true }] as Project[], agents: [], plugins: [] } as unknown as AppState
  assert.deepEqual(authorize('attach:read', { projectId: 'b', path: '/x' }, s), { ok: false, error: HIDDEN })
  assert.deepEqual(authorize('artifact:bytes', { projectId: 'b', path: 'x' }, s), { ok: false, error: HIDDEN })
  assert.equal(authorize('attach:read', { projectId: 'a', path: '/x' }, s).ok, true)
  assert.equal(authorize('fs:browse', '~/', s).ok, true)
})
