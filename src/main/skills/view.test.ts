import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CatalogItem, ProjectSkillsView, SkillsList, UserPlugin } from '../../shared/types.ts'
import { installMissing, projectView, toggle, type ToggleDeps, type ViewInput } from './view.ts'

const item = (id: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({ id, tipo: 'plugin', descricao: `sobre ${id}`, tags: [], ...extra })
const plugin = (id: string, extra: Partial<UserPlugin> = {}): UserPlugin => ({
  id, name: id.split('@')[0], scope: 'user', skills: 2, commands: 0, agents: 1, hooks: false, mcp: false, on: false, ...extra,
})
const list = (o: Partial<SkillsList> = {}): SkillsList => ({ versao: 1, plugins: [], skills: [], sem: [], ...o })
const other = process.platform === 'win32' ? 'mac' : 'win'

function input(o: Partial<ViewInput> = {}): ViewInput {
  return {
    list: null,
    itens: [
      item('alfa@loja'),
      item('beta@loja', { sempre: true }),
      item('gama', { tipo: 'skill' }),
      item('so-outro@loja', { plataformas: [other] }),
    ],
    installed: [plugin('alfa@loja', { hooks: true, description: 'em inglês' }), plugin('beta@loja'), plugin('fora@x', { skills: 5 }), plugin('so-outro@loja')],
    libSkills: new Set(['gama']),
    fallbackOn: new Set(),
    platform: process.platform,
    ...o,
  }
}
const byId = (v: ProjectSkillsView) => Object.fromEntries(v.rows.map((r) => [r.id, r]))

test('rows are the catalog plus installed plugins outside it, minus other platforms', () => {
  const v = projectView(input())
  assert.deepEqual(v.rows.map((r) => r.id).sort(), ['alfa@loja', 'beta@loja', 'fora@x', 'gama'])
  const r = byId(v)
  assert.deepEqual(r['alfa@loja'], {
    id: 'alfa@loja', name: 'alfa', kind: 'plugin', hooks: true, skills: 2, commands: 0, agents: 1,
    description: 'sobre alfa@loja', on: false, installed: true, sempre: false,
  })
  assert.equal(r['fora@x'].description, undefined)
  assert.equal(r['fora@x'].skills, 5)
  assert.deepEqual([r.gama.kind, r.gama.skills, r.gama.installed, r.gama.hooks], ['skill', 1, true, false])
  assert.equal(r['beta@loja'].sempre, true)
  assert.equal(r['beta@loja'].hooks, false)
})

test('without a list, on follows the fallback set; with one, it follows the list', () => {
  const fb = byId(projectView(input({ fallbackOn: new Set(['fora@x']) })))
  assert.deepEqual([fb['fora@x'].on, fb['alfa@loja'].on, fb['beta@loja'].on], [true, false, false])
  const v = projectView(input({ list: list({ plugins: [{ id: 'alfa@loja' }], skills: ['gama'], sem: [] }), fallbackOn: new Set(['fora@x']) }))
  assert.equal(v.hasList, true)
  const r = byId(v)
  assert.deepEqual([r['alfa@loja'].on, r.gama.on, r['beta@loja'].on, r['fora@x'].on], [true, true, true, false])
  const sem = byId(projectView(input({ list: list({ sem: ['beta@loja'] }) })))
  assert.equal(sem['beta@loja'].on, false)
})

test('an item that is on but not installed is marked and listed as missing', () => {
  const v = projectView(input({
    list: list({ plugins: [{ id: 'alfa@loja' }, { id: 'orfao@y' }], skills: ['gama', 'solta'] }),
    installed: [plugin('beta@loja')],
    libSkills: new Set(),
  }))
  const r = byId(v)
  assert.equal(r['alfa@loja'].installed, false)
  assert.equal(r['orfao@y'].on, true)
  assert.equal(r.solta.kind, 'skill')
  assert.deepEqual([...v.missing].sort(), ['alfa@loja', 'gama', 'orfao@y', 'solta'])
  assert.deepEqual(projectView(input()).missing, [])
})

test('a project-scope install counts once, the user-scope one first', () => {
  const v = projectView(input({
    installed: [plugin('alfa@loja#/p', { scope: 'project', hooks: false }), plugin('alfa@loja', { hooks: true })],
  }))
  assert.equal(v.rows.filter((r) => r.id === 'alfa@loja').length, 1)
  assert.equal(byId(v)['alfa@loja'].hooks, true)
})

test('rows sort with the ones on first, then by name', () => {
  const v = projectView(input({ list: list({ plugins: [{ id: 'fora@x' }] }) }))
  assert.deepEqual(v.rows.map((r) => r.name), ['beta', 'fora', 'alfa', 'gama'])
})

test('a broken list shows the error, no list, and the fallback set', () => {
  const v = projectView(input({ list: null, erro: 'skills.json inválido', fallbackOn: new Set(['alfa@loja']) }))
  assert.equal(v.erro, 'skills.json inválido')
  assert.equal(v.hasList, false)
  assert.equal(byId(v)['alfa@loja'].on, true)
  assert.equal(projectView(input({ aviso: 'sem rede' })).aviso, 'sem rede')
})

test('a list without a readable catalog shows the fallback set on too, as the threads get it', () => {
  const v = projectView(input({ itens: [], list: list({ plugins: [{ id: 'alfa@loja' }] }), fallbackOn: new Set(['fora@x']), semCatalogo: true }))
  const r = byId(v)
  assert.deepEqual([r['alfa@loja'].on, r['fora@x'].on, r['beta@loja'].on], [true, true, false])
  const ok = byId(projectView(input({ list: list({ plugins: [{ id: 'alfa@loja' }] }), fallbackOn: new Set(['fora@x']) })))
  assert.equal(ok['fora@x'].on, false)
})

function project(t: { after(fn: () => void): void }): string {
  const p = mkdtempSync(join(tmpdir(), 'view-'))
  t.after(() => rmSync(p, { recursive: true, force: true }))
  return p
}
const readJson = (p: string) => JSON.parse(readFileSync(join(p, '.brandyterm', 'skills.json'), 'utf8'))

function deps(o: Partial<ToggleDeps> = {}) {
  const installs: [string, CatalogItem | undefined][] = []
  const d: ToggleDeps = {
    itens: input().itens,
    installed: new Map([['alfa@loja', '/d/alfa'], ['beta@loja', '/d/beta'], ['fora@x', '/d/fora']]),
    fallbackOn: new Set(['alfa@loja', 'fora@x']),
    install: async (id, it) => {
      installs.push([id, it])
      return { ok: true }
    },
    ...o,
  }
  return { d, installs }
}

test('the first toggle creates the list from everything on in the fallback plus the change', async (t) => {
  const p = project(t)
  const { d, installs } = deps()
  assert.deepEqual(await toggle(p, 'gama', true, d), { ok: true })
  // fora@x is installed and on in the fallback, though outside the catalog: it stays on
  assert.deepEqual(readJson(p), { versao: 1, plugins: [{ id: 'alfa@loja' }, { id: 'fora@x' }], skills: ['gama'], sem: [] })
  assert.equal(installs.length, 0)
  assert.deepEqual(await toggle(p, 'alfa@loja', false, d), { ok: true })
  assert.deepEqual(readJson(p).plugins, [{ id: 'fora@x' }])
})

test('without a catalog, the first toggle keeps the other plugins that were on', async (t) => {
  const p = project(t)
  const { d } = deps({ itens: [] })
  assert.deepEqual(await toggle(p, 'fora@x', false, d), { ok: true })
  assert.deepEqual(readJson(p), { versao: 1, plugins: [{ id: 'alfa@loja' }], skills: [], sem: [] })
})

test('toggling a base item off writes sem, and on again clears it', async (t) => {
  const p = project(t)
  const { d } = deps()
  await toggle(p, 'beta@loja', false, d)
  assert.deepEqual(readJson(p).sem, ['beta@loja'])
  await toggle(p, 'beta@loja', true, d)
  assert.deepEqual(readJson(p).sem, [])
})

test('toggling a missing plugin on installs it; a failed install keeps it on the list', async (t) => {
  const p = project(t)
  const { d, installs } = deps({ installed: new Map() })
  assert.deepEqual(await toggle(p, 'alfa@loja', true, d), { ok: true })
  assert.deepEqual(installs, [['alfa@loja', d.itens[0]]])
  const bad = deps({ installed: new Map(), install: async () => ({ ok: false, erro: 'sem rede' }) })
  assert.deepEqual(await toggle(p, 'beta@loja', true, bad.d), { ok: false, erro: 'Ligado na lista, mas a instalação falhou: sem rede' })
})

test('an installed plugin outside the catalog can be turned on; an unknown id or a broken list is refused', async (t) => {
  const p = project(t)
  const { d, installs } = deps()
  assert.deepEqual(await toggle(p, 'fora@x', true, d), { ok: true })
  assert.ok(readJson(p).plugins.some((x: { id: string }) => x.id === 'fora@x'))
  assert.equal(installs.length, 0)
  assert.deepEqual(await toggle(p, 'nada@z', true, d), { ok: false, erro: 'Item desconhecido: nada@z.' })
  writeFileSync(join(p, '.brandyterm', 'skills.json'), '{ quebrado')
  assert.deepEqual(await toggle(p, 'gama', true, d), { ok: false, erro: 'skills.json inválido: corrija o arquivo antes de mudar a lista.' })
  assert.equal(readFileSync(join(p, '.brandyterm', 'skills.json'), 'utf8'), '{ quebrado')
})

test('installMissing installs the plugins and updates the library once for the skills', async () => {
  const v = projectView(input({ list: list({ plugins: [{ id: 'alfa@loja' }, { id: 'orfao@y' }], skills: ['gama'] }), installed: [], libSkills: new Set() }))
  const { d, installs } = deps()
  let syncs = 0
  const r = await installMissing(v, { ...d, syncLibrary: () => (syncs++, { ok: false, aviso: 'sem rede' }) })
  assert.equal(syncs, 1)
  assert.deepEqual(installs.map(([id, it]) => [id, it?.id]).sort(), [['alfa@loja', 'alfa@loja'], ['beta@loja', 'beta@loja'], ['orfao@y', undefined]])
  assert.deepEqual(r, { ok: false, erro: 'sem rede' })
  const none = await installMissing(projectView(input()), { ...d, syncLibrary: () => assert.fail('sem skills faltando') })
  assert.deepEqual(none, { ok: true })
})
