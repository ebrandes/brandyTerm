import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commitLibrary, libraryUrl, pushLibrary, syncLibrary, type GitRun } from './library.ts'

function fakeGit(codes: Record<string, number> = {}) {
  const calls: string[][] = []
  const git: GitRun = (args) => {
    calls.push(args)
    const verb = args[0] === '-C' ? args[2] : args[0]
    return { code: codes[verb] ?? 0, out: '' }
  }
  return { git, calls }
}

function tmp(t: { after(fn: () => void): void }): string {
  const d = mkdtempSync(join(tmpdir(), 'lib-'))
  t.after(() => rmSync(d, { recursive: true, force: true }))
  return d
}

test('libraryUrl: dono/repo and full https URLs', () => {
  assert.equal(libraryUrl('dono/repo'), 'https://github.com/dono/repo.git')
  assert.equal(libraryUrl(), 'https://github.com/ebrandes/claude-kit.git')
  assert.equal(libraryUrl('https://github.com/x/y.git'), 'https://github.com/x/y.git')
  assert.throws(() => libraryUrl('foo'), /biblioteca inválida/)
  assert.throws(() => libraryUrl('a/b;rm -rf'), /biblioteca inválida/)
})

test('clones when absent', (t) => {
  const dir = join(tmp(t), 'biblioteca')
  const { git, calls } = fakeGit()
  assert.deepEqual(syncLibrary('https://github.com/a/b.git', dir, git), { ok: true })
  assert.deepEqual(calls, [['clone', '--depth', '50', 'https://github.com/a/b.git', dir]])
})

test('pulls when .git exists', (t) => {
  const dir = tmp(t)
  mkdirSync(join(dir, '.git'))
  const { git, calls } = fakeGit()
  assert.deepEqual(syncLibrary('https://github.com/a/b.git', dir, git), { ok: true })
  assert.deepEqual(calls, [['-C', dir, 'pull', '--ff-only']])
})

test('a failed pull keeps the copy and warns', (t) => {
  const dir = tmp(t)
  mkdirSync(join(dir, '.git'))
  const { git } = fakeGit({ pull: 1 })
  assert.deepEqual(syncLibrary('u', dir, git), {
    ok: false,
    aviso: 'Biblioteca sem atualizar (sem rede?): usando a cópia que já existe.',
  })
  assert.deepEqual(readdirSync(dir), ['.git'])
})

test('a failed clone warns that library skills are missing', (t) => {
  const { git } = fakeGit({ clone: 128 })
  assert.deepEqual(syncLibrary('u', join(tmp(t), 'x'), git), {
    ok: false,
    aviso: 'Biblioteca indisponível: skills da biblioteca ficam como "falta instalar".',
  })
})

test('commitLibrary adds the paths, then commits', () => {
  const { git, calls } = fakeGit({ diff: 1 })
  assert.equal(commitLibrary('/lib', 'catálogo: graphify', ['biblioteca/catalogo.json', 'biblioteca/skills/g'], git), true)
  assert.deepEqual(calls[0], ['-C', '/lib', 'add', '--', 'biblioteca/catalogo.json', 'biblioteca/skills/g'])
  assert.deepEqual(calls.at(-1), ['-C', '/lib', 'commit', '-m', 'catálogo: graphify'])
})

test('commitLibrary returns false when nothing changed', () => {
  const { git, calls } = fakeGit({ diff: 0 })
  assert.equal(commitLibrary('/lib', 'm', ['a'], git), false)
  assert.ok(!calls.some((c) => c.includes('commit')))
})

test('pushLibrary reports failure', () => {
  assert.deepEqual(pushLibrary('/lib', fakeGit().git), { ok: true })
  assert.equal(pushLibrary('/lib', fakeGit({ push: 1 }).git).ok, false)
})
