import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { git, setup } from './apply-queue.fixture.ts'

test('another project applies on its own, even touching src/main', async (t) => {
  const s = setup(); t.after(s.cleanup)
  const app = path.join(s.dir, 'app')
  fs.mkdirSync(app)
  git(app, 'init', '-q')
  // another repository as the app, and a packaged app (no repository at all)
  for (const [name, appRoot] of [['um', app], ['dois', null]] as const) {
    const q = s.open(appRoot); await q.start(); t.after(() => q.stop())
    const r = await q.request('p', 't1', { worktree: s.worktree(name), title: name })
    assert.equal(r.auto, true)
    assert.deepEqual([q.list().at(-1)!.status, q.list().at(-1)!.auto], ['pending', true])
    await s.idle(q)
    assert.equal(s.landed(name), true)
    assert.match(s.project.messages.at(-1)!.text, /automaticamente/)
    q.stop()
  }
})

test('BrandyTerm itself applies on its own when only renderer and docs change', async (t) => {
  const s = setup(); t.after(s.cleanup)
  const q = s.open(); await q.start(); t.after(() => q.stop())
  const wt = s.worktree('tela', ['src/renderer/x.tsx', 'README.md', 'docs/img.png'])
  await q.request('p', 't1', { worktree: wt, title: 'tela' })
  assert.deepEqual([q.list()[0].status, q.list()[0].auto], ['pending', true])
  s.project.busy = true
  await s.idle(q)
  assert.equal(s.has('README.md'), false, 'still waits for everything to be idle')
  s.project.busy = false
  await q.tick()
  await s.idle(q)
  assert.deepEqual([s.has('src/renderer/x.tsx'), s.has('README.md'), q.list()[0].status], [true, true, 'applied'])
  assert.match(s.project.messages.at(-1)!.text, /Aplicado automaticamente.*não exige reiniciar/)
})

for (const file of ['src/main/x.ts', 'src/preload/x.ts', 'package.json']) {
  test(`BrandyTerm itself waits for approval when ${file} changes`, async (t) => {
    const s = setup(); t.after(s.cleanup)
    // the project may be configured with a folder inside the repository
    fs.mkdirSync(path.join(s.repo, 'sub'))
    const q = s.open(path.join(s.repo, 'sub')); await q.start(); t.after(() => q.stop())
    const r = await q.request('p', 't1', { worktree: s.worktree('core', ['README.md', file]), title: 'core' })
    assert.equal(r.auto, false)
    await s.idle(q)
    assert.deepEqual([q.list()[0].status, q.list()[0].auto, s.has(file)], ['approval', undefined, false])
    q.approve(q.list()[0].id)
    await s.idle(q)
    assert.equal(s.has(file), true)
    assert.doesNotMatch(s.project.messages.at(-1)!.text, /automaticamente/)
  })
}

test('a file name git would quote does not slip past the approval', async (t) => {
  const s = setup(); t.after(s.cleanup)
  const q = s.open(); await q.start(); t.after(() => q.stop())
  await q.request('p', 't1', { worktree: s.worktree('um', 'src/main/a"b.ts'), title: 'um' })
  assert.equal(q.list()[0].status, 'approval')
})

test('on start, requests still waiting for approval follow the current rule', async (t) => {
  const s = setup(); t.after(s.cleanup)
  const first = s.open(); await first.start()
  await first.request('p', 't1', { worktree: s.worktree('core'), title: 'core' })
  await first.request('p', 't2', { worktree: s.worktree('doc', 'README.md'), title: 'doc' })
  first.stop()
  // as saved by the old rule: everything waited
  const file = path.join(s.data, 'apply-queue.json')
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const i of saved.items) { i.status = 'approval'; delete i.auto }
  fs.writeFileSync(file, JSON.stringify(saved))
  const q = s.open(); await q.start(); t.after(() => q.stop())
  assert.deepEqual(q.list().map((i) => [i.status, i.auto]), [['approval', undefined], ['pending', true]])
  await s.idle(q)
  assert.deepEqual([s.landed('core'), s.has('README.md')], [false, true])
})
