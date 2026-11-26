import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProjectPlugin, projectHash } from './project-plugin.ts'

function setup(t: { after(fn: () => void): void }, skills: string[]) {
  const base = mkdtempSync(join(tmpdir(), 'pplugin-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const lib = join(base, 'lib', 'skills')
  for (const s of skills) mkdirSync(join(lib, s), { recursive: true })
  return { root: join(base, 'project-skills'), lib }
}

test('builds plugin.json and links', (t) => {
  const { root, lib } = setup(t, ['a', 'b'])
  const dir = buildProjectPlugin(root, '/proj/x', ['a', 'b'], lib, process.platform)
  const h = projectHash('/proj/x')
  assert.equal(dir, join(root, h))
  const manifest = JSON.parse(readFileSync(join(dir!, '.claude-plugin', 'plugin.json'), 'utf8'))
  assert.equal(manifest.name, `projeto-${h}`)
  assert.equal(realpathSync(join(dir!, 'skills', 'a')), realpathSync(join(lib, 'a')))
  assert.equal(realpathSync(join(dir!, 'skills', 'b')), realpathSync(join(lib, 'b')))
})

test('idempotent and prunes stale links', (t) => {
  const { root, lib } = setup(t, ['a', 'b'])
  buildProjectPlugin(root, '/proj/x', ['a', 'b'], lib, process.platform)
  const dir = buildProjectPlugin(root, '/proj/x', ['a'], lib, process.platform)!
  assert.equal(existsSync(join(dir, 'skills', 'b')), false)
  assert.ok(lstatSync(join(dir, 'skills', 'a')).isSymbolicLink())
  assert.equal(buildProjectPlugin(root, '/proj/x', ['a'], lib, process.platform), dir)
  assert.ok(existsSync(join(lib, 'b')), 'pruning a link never touches the library')
})

test('link type: junction on win32, dir on darwin', (t) => {
  const { root, lib } = setup(t, ['a'])
  const kinds: string[] = []
  const fake = (_target: string, _path: string, kind: 'dir' | 'junction') => void kinds.push(kind)
  buildProjectPlugin(join(root, 'w'), '/p', ['a'], lib, 'win32', fake)
  buildProjectPlugin(join(root, 'm'), '/p', ['a'], lib, 'darwin', fake)
  assert.deepEqual(kinds, ['junction', 'dir'])
})

test('projectHash is stable, path-sensitive, and case-blind on win32', () => {
  const h = projectHash('/a/b c/ção')
  assert.match(h, /^[0-9a-f]{12}$/)
  assert.equal(projectHash('/a/b c/ção'), h)
  assert.notEqual(projectHash('/a/b'), h)
  assert.equal(projectHash('C:\\X', 'win32'), projectHash('c:\\x', 'win32'))
  assert.equal(projectHash('C:\\X\\', 'win32'), projectHash('c:/x', 'win32'))
})

test('empty skills returns null and removes the old dir', (t) => {
  const { root, lib } = setup(t, ['a'])
  const dir = buildProjectPlugin(root, '/proj/x', ['a'], lib, process.platform)!
  assert.equal(buildProjectPlugin(root, '/proj/x', [], lib, process.platform), null)
  assert.equal(existsSync(dir), false)
  assert.ok(existsSync(join(lib, 'a')))
})
