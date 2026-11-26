import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ApplyQueue } from './apply-queue.ts'
import { appGateway } from './apply-gateway.ts'
import { IDLE_WINDOW_MS, SETTLE_MS, type ApplyQueueView } from '../shared/apply-queue.ts'
import type { Message, Project } from '../shared/types.ts'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })

class Host extends EventEmitter {
  state: { projects: Project[]; applyQueue?: ApplyQueueView }
  constructor(projects: Project[]) { super(); this.state = { projects } }
  msg(author: Message['author'], text: string, extra: Partial<Message> = {}): Message {
    return { id: String(Math.random()), author, text, createdAt: new Date(0).toISOString(), ...extra } as Message
  }
  touch(): void { this.emit('change') }
}

/** a project folder with uncommitted work, and worktrees that each add one file */
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-'))
  const repo = path.join(dir, 'repo')
  fs.mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'um\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'inicial')
  fs.writeFileSync(path.join(repo, 'sujo.txt'), 'do usuário\n')
  const worktree = (name: string, file = `${name}.txt`, content = `${name}\n`) => {
    const wt = path.join(dir, name)
    git(repo, 'worktree', 'add', '-q', '-b', name, wt)
    fs.writeFileSync(path.join(wt, file), content)
    git(wt, 'add', '.')
    git(wt, 'commit', '-qm', name)
    return wt
  }
  const project = { id: 'p', name: 'P', path: repo, busy: false, threads: [], messages: [] } as unknown as Project
  const host = new Host([project])
  const clock = { t: 1_000_000 }
  const data = path.join(dir, 'data')
  const open = () => new ApplyQueue(host, data, () => clock.t)
  /** ticks, then lets enough idle time pass and ticks again */
  const idle = async (q: ApplyQueue) => {
    await q.tick()
    clock.t += Math.max(IDLE_WINDOW_MS, SETTLE_MS) + 1
    await q.tick()
  }
  const has = (f: string) => fs.existsSync(path.join(repo, f))
  return { dir, repo, worktree, project, host, clock, data, open, idle, has, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

test('applies an approved worktree only when nothing runs, without touching the index', async (t) => {
  const s = setup(); t.after(s.cleanup)
  const q = s.open(); await q.start(); t.after(() => q.stop())
  await q.request('p', 't1', { worktree: s.worktree('um'), title: 'um' })
  await s.idle(q)
  assert.equal(s.has('um.txt'), false, 'not approved yet')
  s.project.busy = true
  q.approve(q.list()[0].id)
  await s.idle(q)
  assert.equal(s.has('um.txt'), false, 'something is running')
  assert.equal(s.host.state.applyQueue && s.host.state.applyQueue.running, 1)
  s.project.busy = false
  await q.tick()
  assert.equal(s.has('um.txt'), false, 'idle must last')
  await s.idle(q)
  assert.equal(s.has('um.txt'), true)
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
  assert.deepEqual([s.has('um.txt'), s.has('dois.txt')], [true, false])
  await q.tick()
  assert.equal(s.has('dois.txt'), false, 'waits for the restart the first one may cause')
  await s.idle(q)
  assert.equal(s.has('dois.txt'), true)
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
  fs.writeFileSync(path.join(s.repo, 'um.txt'), 'um\n') // git had written this one
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
  assert.deepEqual([s.has('um.txt'), s.has('depois.txt')], [true, false])
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

test('the gateway tools report what runs and queue a request', async (t) => {
  const s = setup(); t.after(s.cleanup)
  const q = s.open(); await q.start(); t.after(() => q.stop())
  s.project.threads = [{ id: 't1', title: 'eu', state: 'running' }] as unknown as Project['threads']
  const call = (tool: string, args: unknown = {}) =>
    appGateway(q)({ projectId: 'p', threadId: 't1' }, { id: 1, token: '', op: 'app', tool, args }, new AbortController().signal)
  assert.deepEqual(await call('app_status'), { count: 1, running: [{ projectName: 'P', kind: 'thread', title: 'eu', voce: true }], queue: [] })
  assert.match(String(await call('queue_apply', { worktree: s.worktree('um'), title: 'um' })), /Na fila \(posição 1\)/)
  assert.equal(q.list()[0].status, 'approval')
})
