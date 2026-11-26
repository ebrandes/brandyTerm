import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { skillsPaths } from './paths.ts'
import { projectDirs } from './project-dirs.ts'

function setup(t: { after(fn: () => void): void }) {
  const base = mkdtempSync(join(tmpdir(), 'pdirs-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const paths = skillsPaths(join(base, 'userData'))
  const project = join(base, 'meu projeto ção')
  mkdirSync(join(project, '.brandyterm'), { recursive: true })
  mkdirSync(join(paths.lib, 'biblioteca', 'skills', 'graphify'), { recursive: true })
  writeFileSync(
    join(paths.lib, 'biblioteca', 'catalogo.json'),
    JSON.stringify({ versao: 1, itens: [{ id: 'imp@s', tipo: 'plugin' }, { id: 'graphify', tipo: 'skill' }] })
  )
  return { paths, project, base }
}

const writeList = (project: string, body: string) => writeFileSync(join(project, '.brandyterm', 'skills.json'), body)

test('a project without a list uses the fallback', (t) => {
  const { paths, project } = setup(t)
  assert.equal(projectDirs(project, paths, new Map(), process.platform), null)
})

test('a broken list uses the fallback', (t) => {
  const { paths, project } = setup(t)
  writeList(project, '{broken')
  assert.equal(projectDirs(project, paths, new Map(), process.platform), null)
})

test('one installed plugin plus one library skill gives two dirs', (t) => {
  const { paths, project, base } = setup(t)
  writeList(project, JSON.stringify({ versao: 1, plugins: [{ id: 'imp@s' }], skills: ['graphify'], sem: [] }))
  const dirs = projectDirs(project, paths, new Map([['imp@s', join(base, 'imp')]]), process.platform)
  assert.equal(dirs?.length, 2)
  assert.equal(dirs![0], join(base, 'imp'))
  assert.equal(
    realpathSync(join(dirs![1], 'skills', 'graphify')),
    realpathSync(join(paths.lib, 'biblioteca', 'skills', 'graphify'))
  )
})

test('without the library clone, list skills are missing and threads still start', (t) => {
  const { paths, project, base } = setup(t)
  rmSync(paths.lib, { recursive: true, force: true })
  writeList(project, JSON.stringify({ versao: 1, plugins: [{ id: 'imp@s' }], skills: ['graphify'], sem: [] }))
  assert.deepEqual(projectDirs(project, paths, new Map([['imp@s', join(base, 'imp')]]), process.platform), [join(base, 'imp')])
})

test('without a readable catalog the base is unknown: the old set comes along with the list', (t) => {
  const { paths, project, base } = setup(t)
  const installed = new Map([['imp@s', join(base, 'imp')]])
  const old = [join(base, 'kit-core'), join(base, 'imp')]
  writeList(project, JSON.stringify({ versao: 1, plugins: [{ id: 'imp@s' }], skills: [], sem: [] }))
  // a good catalog: the list alone
  assert.deepEqual(projectDirs(project, paths, installed, process.platform, old), [join(base, 'imp')])
  writeFileSync(join(paths.lib, 'biblioteca', 'catalogo.json'), '{bad')
  assert.deepEqual(projectDirs(project, paths, installed, process.platform, old), [join(base, 'imp'), join(base, 'kit-core')])
  rmSync(paths.lib, { recursive: true, force: true })
  assert.deepEqual(projectDirs(project, paths, installed, process.platform, old), [join(base, 'imp'), join(base, 'kit-core')])
})
