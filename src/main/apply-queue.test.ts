import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { appGateway } from './apply-gateway.ts'
import { git, setup } from './apply-queue.fixture.ts'
import type { Project } from '../shared/types.ts'

test('applies an approved worktree only when nothing runs, without touching the index', async (t) => {
  const s = setup(); t.after(s.cleanup)
  const q = s.open(); await q.start(); t.after(() => q.stop())
  await q.request('p', 't1', { worktree: s.worktree('um'), title: 'um' })
  await s.idle(q)
  assert.equal(s.landed('um'), false, 'not approved yet')
  s.project.busy = true
  q.approve(q.list()[0].id)
  await s.idle(q)
  assert.equal(s.landed('um'), false, 'something is running')
  assert.equal(s.host.state.applyQueue && s.host.state.applyQueue.running, 1)
  s.project.busy = false
  await q.tick()
  assert.equal(s.landed('um'), false, 'idle must last')
  await s.idle(q)
  assert.equal(s.landed('um'), true)
  assert.equal(q.list()[0].status, 'applied')
  assert.equal(git(s.repo, 'diff', '--cached', '--name-only'), '')
  assert.match(s.project.messages.at(-1)!.text, /Aplicado/)
})

test('applies one at a time, and the queue survives a restart', async (t) => {
  const s = setup(); t.after(s.cleanup)
  const first = s.open(); await first.start()
  await first.request('p', 't1', { worktree: s.worktree('um'), title: 'um' })
  await first.request('p', 't2', { worktree: s.worktree('dois'), title: 'dois' })
  for (const i of first.list()) first.approve(i.id)
  first.stop()
  const q = s.open(); await q.start(); t.after(() => q.stop())
  assert.deepEqual(q.list().map((i) => i.status), ['pending', 'pending'])
  await s.idle(q)
  assert.deepEqual([s.landed('um'), s.landed('dois')], [true, false])
  await q.tick()
  assert.equal(s.landed('dois'), false, 'waits for the restart the first one may cause')
  await s.idle(q)
  assert.equal(s.landed('dois'), true)
})

test('an apply cut short by the restart is settled by what the folder holds', async (t) => {
  const s = setup(); t.after(s.cleanup)
  const first = s.open(); await first.start()
  await first.request('p', 't1', { worktree: s.worktree('um'), title: 'um' })
  await first.request('p', 't2', { worktree: s.worktree('dois'), title: 'dois' })
  first.stop()
  const file = path.join(s.data, 'apply-queue.json')
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const i of saved.items) i.status = 'applying'
  fs.writeFileSync(file, JSON.stringify(saved))
  fs.mkdirSync(path.join(s.repo, 'src/main'), { recursive: true })
  fs.writeFileSync(path.join(s.repo, 'src/main/um.txt'), 'um\n') // git had written this one
  const q = s.open(); await q.start(); t.after(() => q.stop())
  assert.deepEqual(q.list().map((i) => i.status), ['applied', 'pending'])
})

test('a patch that does not fit fails without changing anything', async (t) => {
  const s = setup(); t.after(s.cleanup)
  const q = s.open(); await q.start(); t.after(() => q.stop())
  const wt = s.worktree('um', 'a.txt', 'da worktree\n')
  fs.writeFileSync(path.join(s.repo, 'a.txt'), 'do usuário\n')
  const r = await q.request('p', 't1', { worktree: wt, title: 'um' })
  assert.match(r.warning!, /não aplica/)
  q.approve(q.list()[0].id)
  await s.idle(q)
  assert.equal(q.list()[0].status, 'failed')
  assert.equal(fs.readFileSync(path.join(s.repo, 'a.txt'), 'utf8'), 'do usuário\n')
})

test('the approval covers only the commit that was queued', async (t) => {
  const s = setup(); t.after(s.cleanup)
  const q = s.open(); await q.start(); t.after(() => q.stop())
  const wt = s.worktree('um')
  await q.request('p', 't1', { worktree: wt, title: 'um' })
  fs.writeFileSync(path.join(wt, 'depois.txt'), 'x\n')
  git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'depois')
  q.approve(q.list()[0].id)
  await s.idle(q)
  assert.deepEqual([s.landed('um'), s.has('depois.txt')], [true, false])
})

test('refuses what is not a clean worktree of the project', async (t) => {
  const s = setup(); t.after(s.cleanup)
  const q = s.open(); await q.start(); t.after(() => q.stop())
  const ask = (worktree: string) => q.request('p', 't1', { worktree, title: 'x' })
  await assert.rejects(ask(s.repo), /própria pasta/)
  await assert.rejects(ask(s.dir), /./)
  const wt = s.worktree('um')
  fs.writeFileSync(path.join(wt, 'solto.txt'), 'x')
  await assert.rejects(ask(wt), /commit/)
  assert.deepEqual(q.list(), [])
})

test('the gateway tools report what runs and queue a request, saying whether it needs approval', async (t) => {
  const s = setup(); t.after(s.cleanup)
  const q = s.open(); await q.start(); t.after(() => q.stop())
  s.project.threads = [{ id: 't1', title: 'eu', state: 'running' }] as unknown as Project['threads']
  const call = (tool: string, args: unknown = {}) =>
    appGateway(q)({ projectId: 'p', threadId: 't1' }, { id: 1, token: '', op: 'app', tool, args }, new AbortController().signal)
  assert.deepEqual(await call('app_status'), { count: 1, running: [{ projectName: 'P', kind: 'thread', title: 'eu', voce: true }], queue: [] })
  const core = String(await call('queue_apply', { worktree: s.worktree('um'), title: 'um' }))
  assert.match(core, /^Na fila \(posição 1\).*reinicia o app.*aprova/)
  assert.match(core, /Não pergunte nada/)
  const docs = String(await call('queue_apply', { worktree: s.worktree('doc', 'README.md'), title: 'doc' }))
  assert.match(docs, /^Na fila \(posição 2\)\. Não precisa de aprovação/)
  assert.match(docs, /Não pergunte nada/)
  assert.deepEqual(q.list().map((i) => i.status), ['approval', 'pending'])
})
