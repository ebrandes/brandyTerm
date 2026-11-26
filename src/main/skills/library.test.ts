import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { commitLibrary, libraryUrl, pushLibrary, switchLibrary, syncLibrary, type GitRun } from './library.ts'

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

function originGit(origin: string | null, cloneFails = false) {
  const calls: string[][] = []
  const git: GitRun = (args) => {
    calls.push(args)
    if (args.includes('get-url')) return origin === null ? { code: 2, out: 'error: No such remote' } : { code: 0, out: origin }
    if (args[0] === 'clone') {
      if (cloneFails) return { code: 128, out: 'fatal: repository not found' }
      mkdirSync(join(args.at(-1)!, '.git'), { recursive: true })
    }
    return { code: 0, out: '' }
  }
  return { git, calls }
}

test('switchLibrary: the same repo (with or without .git) only pulls', (t) => {
  const dir = join(tmp(t), 'biblioteca')
  mkdirSync(join(dir, '.git'), { recursive: true })
  const { git, calls } = originGit('https://github.com/a/b\n')
  assert.deepEqual(switchLibrary('https://github.com/a/b.git', dir, git), { ok: true })
  assert.deepEqual(calls.map((c) => c.slice(2, 4)), [['remote', 'get-url'], ['pull', '--ff-only']])
})

test('switchLibrary: a clone of another repo is kept aside and the new one is cloned', (t) => {
  const root = tmp(t)
  const dir = join(root, 'biblioteca')
  mkdirSync(join(dir, '.git'), { recursive: true })
  writeFileSync(join(dir, 'meu.txt'), 'não perder')
  const { git, calls } = originGit('https://github.com/velho/lib.git')
  const r = switchLibrary('https://github.com/novo/lib.git', dir, git)
  assert.equal(r.ok, true)
  assert.match(r.antiga ?? '', /biblioteca-antiga-\d+$/)
  assert.ok(existsSync(join(r.antiga!, 'meu.txt')))
  // the new clone went to a side folder first, then took the library's place
  assert.match(calls.at(-1)!.at(-1)!, /biblioteca-nova-\d+$/)
  assert.ok(existsSync(join(dir, '.git')))
  assert.equal(existsSync(join(dir, 'meu.txt')), false)
  assert.deepEqual(readdirSync(root).sort(), ['biblioteca', basename(r.antiga!)].sort())
})

test('switchLibrary: when the new repo fails to clone, the old library stays where it was', (t) => {
  const root = tmp(t)
  const dir = join(root, 'biblioteca')
  mkdirSync(join(dir, '.git'), { recursive: true })
  writeFileSync(join(dir, 'meu.txt'), 'não perder')
  const r = switchLibrary('https://github.com/errado/lib.git', dir, originGit('https://github.com/velho/lib.git', true).git)
  assert.equal(r.ok, false)
  assert.equal(r.antiga, undefined)
  assert.match(r.aviso ?? '', /errado\/lib/)
  assert.ok(existsSync(join(dir, 'meu.txt')))
  assert.deepEqual(readdirSync(root), ['biblioteca'])
})

test('switchLibrary: a clone without origin is also kept aside; no clone just clones', (t) => {
  const root = tmp(t)
  const dir = join(root, 'biblioteca')
  mkdirSync(join(dir, '.git'), { recursive: true })
  assert.ok(switchLibrary('https://github.com/a/b.git', dir, originGit(null).git).antiga)
  const fresh = originGit('x')
  assert.deepEqual(switchLibrary('https://github.com/a/b.git', join(root, 'outra'), fresh.git), { ok: true })
  assert.deepEqual(fresh.calls.map((c) => c[0]), ['clone'])
})
