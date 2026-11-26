import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { GitRun } from './library.ts'
import { stageOrigin } from './stage.ts'

/** A fake git whose clone writes `files` into the target dir. */
function fakeGit(files: Record<string, string>) {
  const calls: string[][] = []
  const git: GitRun = (args) => {
    calls.push(args)
    if (args[0] === 'clone') {
      const target = args.at(-1)!
      for (const [rel, body] of Object.entries(files)) {
        mkdirSync(dirname(join(target, rel)), { recursive: true })
        writeFileSync(join(target, rel), body)
      }
      return { code: 0, out: '' }
    }
    if (args.includes('rev-parse')) return { code: 0, out: 'abc1234def\n' }
    return { code: 0, out: '' }
  }
  return { git, calls }
}

function root(t: { after(fn: () => void): void }): string {
  const p = mkdtempSync(join(tmpdir(), 'stage-'))
  t.after(() => rmSync(p, { recursive: true, force: true }))
  return join(p, '.brandyterm', 'tmp', 'skill-install')
}

const gh = (extra = {}) => ({ kind: 'github' as const, owner: 'o', repo: 'r', ...extra })

test('a marketplace repo lists its plugins', (t) => {
  const r = root(t)
  const { git, calls } = fakeGit({ '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'p1' }, { name: 'p2' }, {}] }) })
  const s = stageOrigin(gh(), r, git)
  assert.deepEqual(s, { dir: join(r, 'o-r'), commit: 'abc1234def', kind: 'marketplace', plugins: ['p1', 'p2'], skills: [] })
  assert.deepEqual(calls[0], ['clone', '--depth', '1', 'https://github.com/o/r.git', join(r, 'o-r')])
})

test('a skills repo lists skills/<nome>/SKILL.md', (t) => {
  const r = root(t)
  const { git } = fakeGit({ 'skills/a/SKILL.md': '', 'skills/b/SKILL.md': '', 'skills/c/README.md': '' })
  const s = stageOrigin(gh(), r, git)
  assert.ok(!('erro' in s))
  assert.equal(s.kind, 'skills')
  assert.deepEqual(s.skills, ['a', 'b'])
})

test('a sub folder pointing at one skill', (t) => {
  const r = root(t)
  const { git, calls } = fakeGit({ 'skills/x/SKILL.md': '', 'skills/y/SKILL.md': '' })
  const s = stageOrigin(gh({ sub: 'skills/x', ref: 'dev' }), r, git)
  assert.ok(!('erro' in s))
  assert.deepEqual(s.skills, ['x'])
  assert.equal(s.dir, join(r, 'o-r', 'skills', 'x'))
  assert.deepEqual(calls[0], ['clone', '--depth', '1', '--branch', 'dev', 'https://github.com/o/r.git', join(r, 'o-r')])
})

test('a repo with neither is an error', (t) => {
  const { git } = fakeGit({ 'README.md': '' })
  assert.deepEqual(stageOrigin(gh(), root(t), git), { erro: 'Não achei plugin nem skill nesse repositório.' })
})

test('writes tmp/.gitignore and replaces an old copy', (t) => {
  const r = root(t)
  mkdirSync(join(r, 'o-r'), { recursive: true })
  writeFileSync(join(r, 'o-r', 'velho.txt'), '')
  stageOrigin(gh(), r, fakeGit({ 'skills/a/SKILL.md': '' }).git)
  assert.equal(readFileSync(join(dirname(r), '.gitignore'), 'utf8'), '*\n')
  assert.equal(existsSync(join(r, 'o-r', 'velho.txt')), false)
})

test('a failed clone is an error', (t) => {
  const git: GitRun = () => ({ code: 128, out: 'not found' })
  assert.ok('erro' in stageOrigin(gh(), root(t), git))
})
