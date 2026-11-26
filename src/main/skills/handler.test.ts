import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, item } from './handler-fixture.ts'
import { emptyList, listPath, readList, writeList } from './project-list.ts'

const imp = item('impeccable@impeccable', { descricao: 'Acabamento de interface.' })
const base = item('kit-core@claude-kit', { sempre: true })
const vivo = item('vivo@claude-kit-private', { corporativo: true, tags: ['vivo'] })
const graphify = item('graphify')
const itens = [imp, base, vivo, graphify]

test('a skills tool from a thread that is not a skills thread is refused: no card, no file', async (t) => {
  const f = fixture(t, { itens, skillsTask: null })
  await assert.rejects(f.call('skills_add', { id: imp.id, motivo: 'tem front' }), {
    message: 'Ferramenta de skills só roda em /skill-init, /skill-refresh ou /skill-install.',
  })
  await assert.rejects(f.call('skills_catalog'), /só roda em \/skill-init/)
  assert.equal(f.asks.length, 0)
  assert.equal(existsSync(listPath(f.project)), false)
})

test('skills_add for an id outside the catalog is refused: no card, no file', async (t) => {
  const f = fixture(t, { itens })
  await assert.rejects(f.call('skills_add', { id: 'nada@lugar', motivo: 'x' }), { message: 'Item fora do catálogo: use skills_resolve.' })
  assert.equal(f.asks.length, 0)
  assert.equal(existsSync(listPath(f.project)), false)
  assert.equal(f.installs.length, 0)
})

test('skills_add approved writes the list and installs a missing plugin once', async (t) => {
  const f = fixture(t, { itens })
  const out = await f.call('skills_add', { id: imp.id, motivo: 'O projeto tem front em React.' })
  assert.match(String(out), /Ligado/)
  assert.deepEqual(readList(f.project).list?.plugins, [{ id: imp.id }])
  assert.deepEqual(f.installs.map((i) => i.id), [imp.id])
  assert.equal(f.installs[0].item?.id, imp.id)
  assert.deepEqual(f.changed, ['p1'])
  // one card, a connector card, saying what and why
  assert.equal(f.asks.length, 1)
  const a = f.asks[0]
  assert.equal(a.tool, 'mcp__skills__skills_add')
  assert.deepEqual(a.connector, { id: 'skills', name: 'Skills', tool: 'skills_add' })
  assert.equal(a.summary, `Ligar ${imp.id} neste projeto`)
  assert.match(a.detail ?? '', /O projeto tem front em React\./)
  assert.match(a.detail ?? '', /Acabamento de interface\./)
})

test('skills_add for a plugin already installed does not install it again', async (t) => {
  const f = fixture(t, { itens, installed: [imp.id] })
  await f.call('skills_add', { id: imp.id, motivo: 'x' })
  assert.deepEqual(readList(f.project).list?.plugins, [{ id: imp.id }])
  assert.equal(f.installs.length, 0)
})

test('skills_add of a loose skill lists it and installs nothing', async (t) => {
  const f = fixture(t, { itens })
  await f.call('skills_add', { id: 'graphify', motivo: 'x' })
  assert.deepEqual(readList(f.project).list?.skills, ['graphify'])
  assert.equal(f.installs.length, 0)
})

test('"Sempre" on a skills card proceeds for this call', async (t) => {
  const f = fixture(t, { itens, answers: ['forever'] })
  await f.call('skills_add', { id: 'graphify', motivo: 'x' })
  assert.deepEqual(readList(f.project).list?.skills, ['graphify'])
})

test('skills_add denied writes nothing and the thread moves on', async (t) => {
  const f = fixture(t, { itens, answers: ['deny'] })
  assert.equal(await f.call('skills_add', { id: imp.id, motivo: 'x' }), 'Recusado pelo usuário.')
  assert.equal(existsSync(listPath(f.project)), false)
  assert.equal(f.installs.length, 0)
  assert.deepEqual(f.changed, [])
})

test('skills_remove on a sempre item puts it in sem', async (t) => {
  const f = fixture(t, { itens })
  writeList(f.project, { ...emptyList(), skills: ['graphify'] })
  await f.call('skills_remove', { id: base.id, motivo: 'não usa' })
  assert.deepEqual(readList(f.project).list, { versao: 1, plugins: [], skills: ['graphify'], sem: [base.id] })
  assert.equal(f.asks[0].summary, `Tirar ${base.id} deste projeto`)
})

test('skills_remove drops a listed item, even one the catalog no longer has', async (t) => {
  const f = fixture(t, { itens })
  writeList(f.project, { ...emptyList(), plugins: [{ id: 'velho@loja' }, { id: imp.id }] })
  await f.call('skills_remove', { id: 'velho@loja', motivo: 'saiu da biblioteca' })
  assert.deepEqual(readList(f.project).list?.plugins, [{ id: imp.id }])
})

test('skills_remove in a project without a list is refused', async (t) => {
  const f = fixture(t, { itens })
  await assert.rejects(f.call('skills_remove', { id: base.id, motivo: 'x' }), /sem lista/)
  assert.equal(f.asks.length, 0)
  assert.equal(existsSync(listPath(f.project)), false)
})

test('skills_add on a corporate item lists it and copies nothing', async (t) => {
  const f = fixture(t, { itens, installed: [vivo.id] })
  await f.call('skills_add', { id: vivo.id, motivo: 'projeto Vivo' })
  assert.deepEqual(readList(f.project).list?.plugins, [{ id: vivo.id }])
  assert.deepEqual(readdirSync(f.project), ['.brandyterm'])
  assert.deepEqual(readdirSync(join(f.project, '.brandyterm')), ['skills.json'])
  assert.equal(existsSync(join(f.paths.lib, 'biblioteca', 'skills')), false)
  assert.equal(f.scans.length, 0)
  assert.equal(f.installs.length, 0)
})

test('a broken skills.json is never overwritten', async (t) => {
  const f = fixture(t, { itens })
  mkdirSync(join(f.project, '.brandyterm'), { recursive: true })
  writeFileSync(listPath(f.project), '{ quebrado')
  await assert.rejects(f.call('skills_add', { id: imp.id, motivo: 'x' }), /skills\.json inválido/)
  await assert.rejects(f.call('skills_remove', { id: imp.id, motivo: 'x' }), /skills\.json inválido/)
  assert.equal(readFileSync(listPath(f.project), 'utf8'), '{ quebrado')
  assert.equal(f.asks.length, 0)
})

test('skills_catalog returns the items and the current list', async (t) => {
  const f = fixture(t, { itens })
  writeList(f.project, { ...emptyList(), skills: ['graphify'] })
  const out = (await f.call('skills_catalog')) as { itens: Record<string, unknown>[]; lista: unknown }
  const byId = Object.fromEntries(out.itens.map((i) => [i.id, i]))
  assert.deepEqual(byId[imp.id], { id: imp.id, tipo: 'plugin', descricao: 'Acabamento de interface.', tags: [] })
  assert.deepEqual(byId[vivo.id], { id: vivo.id, tipo: 'plugin', descricao: vivo.descricao, tags: ['vivo'], corporativo: true })
  assert.equal(byId[base.id].sempre, true)
  assert.deepEqual(out.lista, { versao: 1, plugins: [], skills: ['graphify'], sem: [] })
})

test('skills_push asks, then pushes the library; denied, it does not push', async (t) => {
  const f = fixture(t, { itens, answers: ['deny'] })
  assert.equal(await f.call('skills_push'), 'Recusado pelo usuário.')
  assert.equal(f.gitCalls.some((a) => a.includes('push')), false)
  assert.match(String(await f.call('skills_push')), /enviada/)
  assert.deepEqual(f.gitCalls.filter((a) => a.includes('push')), [['-C', f.paths.lib, 'push']])
  assert.equal(f.asks.length, 2)
})

test('a call the agent already cancelled shows no card', async (t) => {
  const f = fixture(t, { itens })
  const ctl = new AbortController()
  ctl.abort()
  await assert.rejects(f.call('skills_add', { id: imp.id, motivo: 'x' }, ctl.signal), /cancelada/)
  assert.equal(f.asks.length, 0)
  assert.equal(existsSync(listPath(f.project)), false)
})

test('an unknown skills tool and missing arguments are refused', async (t) => {
  const f = fixture(t, { itens })
  await assert.rejects(f.call('skills_tudo'), /desconhecida/)
  await assert.rejects(f.call('skills_add', { motivo: 'x' }), /id/)
  assert.equal(f.asks.length, 0)
})
