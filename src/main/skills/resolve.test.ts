import test from 'node:test'
import assert from 'node:assert/strict'
import type { CatalogItem, SkillsList } from '../../shared/types.ts'
import { resolveProject } from './resolve.ts'

const item = (id: string, tipo: 'plugin' | 'skill', extra: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  tipo,
  descricao: '',
  tags: [],
  ...extra,
})
const list = (l: Partial<SkillsList>): SkillsList => ({ versao: 1, plugins: [], skills: [], sem: [], ...l })
const run = (l: Partial<SkillsList>, itens: CatalogItem[], installed: Record<string, string> = {}, lib: string[] = [], platform: NodeJS.Platform = 'darwin') =>
  resolveProject({ list: list(l), itens, installed: new Map(Object.entries(installed)), libSkills: new Set(lib), platform })

test('sempre minus sem', () => {
  const itens = [item('kit-core@k', 'plugin', { sempre: true }), item('kit-tokens@k', 'plugin', { sempre: true })]
  const r = run({ sem: ['kit-tokens@k'] }, itens, { 'kit-core@k': '/i/core', 'kit-tokens@k': '/i/tokens' })
  assert.deepEqual(r.pluginDirs, ['/i/core'])
  assert.deepEqual(r.missing, [])
})

test('list plugins: installed load, missing are reported', () => {
  const itens = [item('a@s', 'plugin'), item('b@s', 'plugin')]
  const r = run({ plugins: [{ id: 'a@s' }, { id: 'b@s' }] }, itens, { 'a@s': '/i/a' })
  assert.deepEqual(r.pluginDirs, ['/i/a'])
  assert.deepEqual(r.missing, [{ id: 'b@s', tipo: 'plugin' }])
})

test('skills: present in the library load, absent are missing', () => {
  const r = run({ skills: ['graphify', 'gone'] }, [item('graphify', 'skill')], {}, ['graphify'])
  assert.deepEqual(r.skills, ['graphify'])
  assert.deepEqual(r.missing, [{ id: 'gone', tipo: 'skill' }])
})

test('platform: a sempre item for another system is skipped silently', () => {
  const itens = [item('win-only@k', 'plugin', { sempre: true, plataformas: ['win'] })]
  const r = run({}, itens, {}, [], 'darwin')
  assert.deepEqual(r, { pluginDirs: [], skills: [], missing: [] })
})

test('an installed plugin the catalog does not know still loads', () => {
  const r = run({ plugins: [{ id: 'new@s' }] }, [], { 'new@s': '/i/new' })
  assert.deepEqual(r.pluginDirs, ['/i/new'])
})

test('no duplicates when an id is both sempre and listed', () => {
  const itens = [item('kit-core@k', 'plugin', { sempre: true }), item('g', 'skill', { sempre: true })]
  const r = run({ plugins: [{ id: 'kit-core@k' }], skills: ['g', 'g'] }, itens, { 'kit-core@k': '/i/core' }, ['g'])
  assert.deepEqual(r.pluginDirs, ['/i/core'])
  assert.deepEqual(r.skills, ['g'])
})
