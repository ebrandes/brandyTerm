import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { copySkill } from './import.ts'

const meta = { repo: 'o/r', commit: 'abc1234', licenca: 'MIT', estrelas: 150 }

function tmp(t: { after(fn: () => void): void }): string {
  const p = mkdtempSync(join(tmpdir(), 'skimp-'))
  t.after(() => rmSync(p, { recursive: true, force: true }))
  return p
}

function write(root: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
}

/** every .json under dir, recursively */
function jsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => join(e.parentPath, e.name))
}

test('copies a skill from <staging>/skills/<nome>, leaving .git out', (t) => {
  const root = tmp(t)
  const staging = join(root, 'stage', 'o-r')
  write(staging, { 'skills/foo/SKILL.md': '# foo de teste', 'skills/foo/ref/a.txt': 'a', 'skills/foo/.git/HEAD': 'x', '.git/HEAD': 'y' })
  const lib = join(root, 'lib', 'skills')
  copySkill(staging, 'foo', lib, meta)
  assert.equal(readFileSync(join(lib, 'foo', 'SKILL.md'), 'utf8'), '# foo de teste')
  assert.equal(readFileSync(join(lib, 'foo', 'ref', 'a.txt'), 'utf8'), 'a')
  assert.equal(existsSync(join(lib, 'foo', '.git')), false)
})

test('origem.json holds exactly repo, commit, licenca, estrelas and an ISO importado', (t) => {
  const root = tmp(t)
  const staging = join(root, 'o-r')
  write(staging, { 'skills/foo/SKILL.md': '# foo', 'skills/foo/origem.json': '{"repo":"outro"}' })
  const lib = join(root, 'lib')
  copySkill(staging, 'foo', lib, { ...meta, licenca: null, estrelas: null })
  const o = JSON.parse(readFileSync(join(lib, 'foo', 'origem.json'), 'utf8'))
  assert.deepEqual(Object.keys(o).sort(), ['commit', 'estrelas', 'importado', 'licenca', 'repo'])
  assert.deepEqual({ ...o, importado: undefined }, { repo: 'o/r', commit: 'abc1234', licenca: null, estrelas: null, importado: undefined })
  assert.match(o.importado, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
})

test('no JSON it writes carries an absolute path', (t) => {
  const root = tmp(t)
  const staging = join(root, 'o-r')
  write(staging, { 'skills/foo/SKILL.md': '# foo', 'skills/foo/dados.json': '{"a":1}' })
  const lib = join(root, 'lib')
  copySkill(staging, 'foo', lib, meta)
  const files = jsonFiles(join(lib, 'foo'))
  assert.equal(files.length, 2)
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    assert.equal(text.includes(root), false, f)
    assert.equal(/"(\/|[A-Za-z]:\\)/.test(text), false, f)
  }
})

test('a staging that is itself the skill (SKILL.md at its root) is copied when the name matches', (t) => {
  const root = tmp(t)
  const staging = join(root, 'o-r', 'foo')
  write(staging, { 'SKILL.md': '# foo sozinha' })
  const lib = join(root, 'lib')
  copySkill(staging, 'foo', lib, meta)
  assert.equal(readFileSync(join(lib, 'foo', 'SKILL.md'), 'utf8'), '# foo sozinha')
  assert.throws(() => copySkill(staging, 'bar', lib, meta), /bar não encontrada/)
})

test('replaces an older copy: files it no longer has are gone', (t) => {
  const root = tmp(t)
  const staging = join(root, 'o-r')
  write(staging, { 'skills/foo/SKILL.md': '# nova' })
  const lib = join(root, 'lib')
  write(lib, { 'foo/SKILL.md': '# velha', 'foo/sobra.md': 'x' })
  copySkill(staging, 'foo', lib, meta)
  assert.equal(readFileSync(join(lib, 'foo', 'SKILL.md'), 'utf8'), '# nova')
  assert.equal(existsSync(join(lib, 'foo', 'sobra.md')), false)
})

test('a bad name is refused before anything is written', (t) => {
  const root = tmp(t)
  const lib = join(root, 'lib')
  for (const nome of ['..', '.', 'a/b', '', 'x y', '../fora']) {
    assert.throws(() => copySkill(root, nome, lib, meta), /Nome de skill inválido/)
  }
  assert.equal(existsSync(lib), false)
})

test('symlinks in the skill are left out', { skip: process.platform === 'win32' }, (t) => {
  const root = tmp(t)
  const staging = join(root, 'o-r')
  write(staging, { 'skills/foo/SKILL.md': '# foo' })
  writeFileSync(join(root, 'segredo.txt'), 'não copiar')
  symlinkSync(join(root, 'segredo.txt'), join(staging, 'skills', 'foo', 'link.txt'))
  const lib = join(root, 'lib')
  copySkill(staging, 'foo', lib, meta)
  assert.equal(existsSync(join(lib, 'foo', 'link.txt')), false)
  assert.equal(existsSync(join(lib, 'foo', 'SKILL.md')), true)
})

test('a skill reached through a link that leaves the staging is refused', { skip: process.platform === 'win32' }, (t) => {
  const root = tmp(t)
  const fora = join(root, 'fora')
  write(fora, { 'foo/SKILL.md': '# de fora', 'bar/SKILL.md': '# de fora' })
  const staging = join(root, 'o-r')
  mkdirSync(join(staging, 'skills'), { recursive: true })
  // the whole skills/ folder is a link, and skills/bar is a link
  const viaDir = join(root, 'o-s')
  mkdirSync(viaDir)
  symlinkSync(fora, join(viaDir, 'skills'), 'dir')
  symlinkSync(join(fora, 'bar'), join(staging, 'skills', 'bar'), 'dir')
  const lib = join(root, 'lib')
  assert.throws(() => copySkill(viaDir, 'foo', lib, meta), /fora da pasta analisada/)
  assert.throws(() => copySkill(staging, 'bar', lib, meta), /fora da pasta analisada/)
  assert.equal(existsSync(lib), false)
})

test('a name starting with "-" is refused (it would read as a flag)', (t) => {
  const root = tmp(t)
  assert.throws(() => copySkill(root, '-x', join(root, 'lib'), meta), /Nome de skill inválido/)
})
