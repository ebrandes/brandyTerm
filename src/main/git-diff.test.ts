import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffPathInside, fileDiff } from './git-diff.ts'

function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'brandy-diff-')))
  const root = join(base, 'proj')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'a.ts'), 'one\ntwo\nthree\n')
  writeFileSync(join(base, 'outside.txt'), 'segredo\n')
  let linked = true
  try {
    symlinkSync(join(base, 'outside.txt'), join(root, 'link.txt'))
    symlinkSync(base, join(root, 'up'))
  } catch (e) {
    if (process.platform !== 'win32') throw e
    linked = false
  }
  return { base, root, linked }
}

const gitIn = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' })

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
})()

test('diffPathInside accepts files inside the project, also deleted ones', () => {
  const { root } = fixture()
  assert.equal(diffPathInside(root, 'src/a.ts'), 'src/a.ts')
  assert.equal(diffPathInside(root, './src/../src/a.ts'), 'src/a.ts')
  assert.equal(diffPathInside(root, 'src/gone.ts'), 'src/gone.ts')
  assert.equal(diffPathInside(root, 'new/dir/gone.ts'), 'new/dir/gone.ts')
})

test('diffPathInside refuses escapes, absolute paths, folders and symlinks out', () => {
  const { base, root, linked } = fixture()
  for (const bad of ['', '..', '../outside.txt', 'src/../../outside.txt', join(base, 'outside.txt'), '/etc/passwd', 'C:\\x', 'src', 'a\0b'])
    assert.equal(diffPathInside(root, bad), null, JSON.stringify(bad))
  if (linked) {
    assert.equal(diffPathInside(root, 'link.txt'), null)
    assert.equal(diffPathInside(root, 'up/outside.txt'), null)
    assert.equal(diffPathInside(root, 'up/missing.txt'), null)
  }
  assert.equal(diffPathInside(join(base, 'nope'), 'src/a.ts'), null)
})

test('fileDiff outside a repository says not-git; bad paths say invalid', { skip: !hasGit }, async () => {
  const { root } = fixture()
  assert.deepEqual(await fileDiff(root, 'src/a.ts'), { kind: 'not-git' })
  assert.deepEqual(await fileDiff(root, '../outside.txt'), { kind: 'invalid' })
})

test('fileDiff: changed, unchanged, untracked and deleted files', { skip: !hasGit }, async () => {
  const { root } = fixture()
  rmSync(join(root, 'link.txt'), { force: true })
  rmSync(join(root, 'up'), { force: true })
  writeFileSync(join(root, 'src', 'b.ts'), 'b\n')
  gitIn(root, 'init', '-q')
  // before any commit a tracked file diffs against the empty tree
  gitIn(root, 'add', 'src/a.ts')
  const staged = await fileDiff(root, 'src/a.ts')
  assert.equal(staged.kind === 'ok' && staged.summary.isNew && staged.summary.added, 3)
  gitIn(root, 'add', '.')
  gitIn(root, 'commit', '-q', '-m', 'init')

  assert.deepEqual(await fileDiff(root, 'src/a.ts'), {
    kind: 'ok',
    summary: { added: 0, removed: 0, isNew: false, deleted: false, binary: false, hunks: [], truncated: false }
  })
  writeFileSync(join(root, 'src', 'a.ts'), 'one\n2\nthree\nfour\n')
  const changed = await fileDiff(root, 'src/a.ts')
  assert.ok(changed.kind === 'ok')
  assert.equal(changed.summary.added, 2)
  assert.equal(changed.summary.removed, 1)
  assert.equal(changed.summary.hunks.length, 1)

  writeFileSync(join(root, 'src', 'new.ts'), 'x\ny\n')
  const fresh = await fileDiff(root, 'src/new.ts')
  assert.ok(fresh.kind === 'ok' && fresh.summary.isNew && fresh.summary.added === 2)

  rmSync(join(root, 'src', 'b.ts'))
  const gone = await fileDiff(root, 'src/b.ts')
  assert.ok(gone.kind === 'ok' && gone.summary.deleted && gone.summary.removed === 1)

  // the viewer only reads: nothing new was staged
  assert.equal(String(gitIn(root, 'diff', '--cached', '--name-only')), '')
})
