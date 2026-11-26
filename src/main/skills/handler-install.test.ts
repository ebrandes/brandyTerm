import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { readCatalog } from './catalog.ts'
import { fixture, item, write } from './handler-fixture.ts'
import { listPath, readList } from './project-list.ts'

const SKILLS_REPO = { 'skills/foo/SKILL.md': '# foo de teste', 'skills/bar/SKILL.md': '# bar de teste' }
const MARKET_REPO = {
  '.claude-plugin/marketplace.json': JSON.stringify({
    name: 'loja-x',
    plugins: [
      { name: 'p1', source: './plugins/p1' },
      { name: 'p2', source: { source: 'github', repo: 'outro/repo' } },
      { name: 'p3', source: '../fora' },
    ],
  }),
  'plugins/p1/.claude-plugin/plugin.json': '{"name":"p1"}',
}
const vivo = item('vivo@claude-kit-private', { corporativo: true, loja: 'ebrandes/claude-kit-private' })
const itens = [item('graphify'), vivo]

const stagingOf = (project: string) => join(project, '.brandyterm', 'tmp', 'skill-install', 'o-r')
const libSkills = (lib: string) => join(lib, 'biblioteca', 'skills')
const foo = { nome: 'foo', descricao: 'Faz foo.', tags: ['teste'] }

test('skills_resolve stages a GitHub repo of skills, with stars and license', async (t) => {
  const f = fixture(t, { itens, repo: SKILLS_REPO })
  const out = await f.call('skills_resolve', { origem: 'https://github.com/o/r' })
  assert.deepEqual(out, {
    kind: 'skills', staging: stagingOf(f.project), repo: 'o/r', commit: 'abc1234',
    estrelas: 120, licenca: 'MIT', plugins: [], skills: ['bar', 'foo'],
  })
  assert.equal(f.asks.length, 0)
})

test('skills_resolve: when gh fails, stars and license are null', async (t) => {
  const f = fixture(t, { itens, repo: SKILLS_REPO, repoMeta: async () => { throw new Error('gh: não autenticado') } })
  const out = (await f.call('skills_resolve', { origem: 'o/r' })) as { estrelas: unknown; licenca: unknown }
  assert.equal(out.estrelas, null)
  assert.equal(out.licenca, null)
})

test('skills_resolve with a catalog id returns the item, and an unknown id is refused', async (t) => {
  const f = fixture(t, { itens })
  assert.deepEqual(await f.call('skills_resolve', { origem: 'graphify' }), { kind: 'catalog', item: item('graphify') })
  await assert.rejects(f.call('skills_resolve', { origem: 'nada' }), /nada não está no catálogo/)
  await assert.rejects(f.call('skills_resolve', { origem: '../x' }), /Origem inválida/)
  assert.equal(f.gitCalls.length, 0)
})

test('skills_resolve never clones a corporate store', async (t) => {
  const f = fixture(t, { itens: [item('graphify'), { ...vivo, loja: undefined }, item('outro@corp', { corporativo: true, loja: 'Corp/Kit' })], repo: SKILLS_REPO })
  await assert.rejects(f.call('skills_resolve', { origem: 'ebrandes/claude-kit-private' }), /corporativ/)
  await assert.rejects(f.call('skills_resolve', { origem: 'https://github.com/corp/kit' }), /corporativ/)
  assert.equal(f.gitCalls.length, 0)
  assert.equal(existsSync(join(f.project, '.brandyterm')), false)
})

test('skills_resolve without the library clone is refused before cloning', async (t) => {
  const f = fixture(t, { itens, repo: SKILLS_REPO, noLib: true })
  await assert.rejects(f.call('skills_resolve', { origem: 'o/r' }), /Biblioteca não está clonada/)
  assert.equal(f.gitCalls.length, 0)
})

test('skills_import with a staging dir outside <projeto>/.brandyterm/tmp/skill-install is refused', async (t) => {
  const f = fixture(t, { itens, repo: SKILLS_REPO })
  const fora = join(f.root, 'fora')
  write(fora, SKILLS_REPO)
  await assert.rejects(f.call('skills_import', { staging: fora, itens: [foo] }), /Pasta de análise inválida/)
  // inside the root but never returned by skills_resolve
  const solta = join(f.project, '.brandyterm', 'tmp', 'skill-install', 'x-y')
  write(solta, SKILLS_REPO)
  await assert.rejects(f.call('skills_import', { staging: solta, itens: [foo] }), /Pasta de análise inválida/)
  assert.equal(f.scans.length, 0)
  assert.equal(f.asks.length, 0)
})

test('skills_import refuses a resolved staging that was swapped for a link outside', { skip: process.platform === 'win32' }, async (t) => {
  const f = fixture(t, { itens, repo: SKILLS_REPO })
  const { staging } = (await f.call('skills_resolve', { origem: 'o/r' })) as { staging: string }
  const fora = join(f.root, 'fora')
  write(fora, SKILLS_REPO)
  rmSync(staging, { recursive: true, force: true })
  symlinkSync(fora, staging, 'dir')
  await assert.rejects(f.call('skills_import', { staging, itens: [foo] }), /Pasta de análise inválida/)
  assert.equal(f.scans.length, 0)
})

test('skills_import with a blocked scan fails with the counts and leaves the library unchanged', async (t) => {
  const f = fixture(t, { itens, repo: SKILLS_REPO, scan: { ok: true, counts: { HIGH: 1, LOW: 2 }, blocked: true } })
  const before = readFileSync(join(f.paths.lib, 'biblioteca', 'catalogo.json'), 'utf8')
  const { staging } = (await f.call('skills_resolve', { origem: 'o/r' })) as { staging: string }
  await assert.rejects(f.call('skills_import', { staging, itens: [foo] }), /Bloqueado pela checagem de segurança: 1 HIGH, 2 LOW/)
  assert.equal(readFileSync(join(f.paths.lib, 'biblioteca', 'catalogo.json'), 'utf8'), before)
  assert.equal(existsSync(libSkills(f.paths.lib)), false)
  assert.equal(existsSync(listPath(f.project)), false)
  assert.equal(f.asks.length, 0)
  assert.equal(f.gitCalls.some((a) => a.includes('commit')), false)
  assert.equal(existsSync(staging), false)
})

test('skills_import copies, catalogs, lists and commits a skill, then deletes the staging', async (t) => {
  const f = fixture(t, { itens, repo: SKILLS_REPO })
  const { staging } = (await f.call('skills_resolve', { origem: 'o/r' })) as { staging: string }
  const out = await f.call('skills_import', { staging, itens: [foo] })
  assert.match(String(out), /skills_push/)
  assert.deepEqual(f.scans, [staging])
  assert.equal(f.asks.length, 1)
  assert.equal(f.asks[0].summary, 'Importar foo de o/r para a biblioteca e ligar neste projeto')
  assert.equal(readFileSync(join(libSkills(f.paths.lib), 'foo', 'SKILL.md'), 'utf8'), '# foo de teste')
  assert.equal(JSON.parse(readFileSync(join(libSkills(f.paths.lib), 'foo', 'origem.json'), 'utf8')).repo, 'o/r')
  assert.deepEqual(readCatalog(f.paths.lib).itens.find((i) => i.id === 'foo'), { id: 'foo', tipo: 'skill', descricao: 'Faz foo.', tags: ['teste'] })
  assert.deepEqual(readList(f.project).list?.skills, ['foo'])
  assert.ok(f.gitCalls.some((a) => a.includes('commit')))
  assert.ok(f.gitCalls.some((a) => a.includes('add') && a.includes(join('biblioteca', 'skills', 'foo'))))
  assert.equal(existsSync(staging), false)
  assert.deepEqual(f.changed, ['p1'])
  // the staging is spent: importing it again is refused
  await assert.rejects(f.call('skills_import', { staging, itens: [foo] }), /Pasta de análise inválida/)
})

test('skills_import of a name already in the library asks to replace it; denying keeps the old copy', async (t) => {
  const f = fixture(t, { itens, repo: SKILLS_REPO, answers: ['allow', 'deny'] })
  write(libSkills(f.paths.lib), { 'foo/SKILL.md': '# velha' })
  const { staging } = (await f.call('skills_resolve', { origem: 'o/r' })) as { staging: string }
  await f.call('skills_import', { staging, itens: [foo] })
  assert.equal(f.asks.length, 2)
  assert.equal(f.asks[1].summary, 'Substituir foo na biblioteca?')
  assert.equal(readFileSync(join(libSkills(f.paths.lib), 'foo', 'SKILL.md'), 'utf8'), '# velha')
  assert.equal(readCatalog(f.paths.lib).itens.some((i) => i.id === 'foo'), false)
  assert.equal(existsSync(listPath(f.project)), false)
})

test('skills_import of a name already in the library, replace allowed, swaps the copy', async (t) => {
  const f = fixture(t, { itens, repo: SKILLS_REPO })
  write(libSkills(f.paths.lib), { 'foo/SKILL.md': '# velha' })
  const { staging } = (await f.call('skills_resolve', { origem: 'o/r' })) as { staging: string }
  await f.call('skills_import', { staging, itens: [foo] })
  assert.equal(f.asks.length, 2)
  assert.equal(readFileSync(join(libSkills(f.paths.lib), 'foo', 'SKILL.md'), 'utf8'), '# foo de teste')
})

test('skills_import refuses a name the staging does not hold, before scanning', async (t) => {
  const f = fixture(t, { itens, repo: SKILLS_REPO })
  const { staging } = (await f.call('skills_resolve', { origem: 'o/r' })) as { staging: string }
  await assert.rejects(f.call('skills_import', { staging, itens: [{ ...foo, nome: 'zzz' }] }), /zzz não está em o\/r/)
  await assert.rejects(f.call('skills_import', { staging, itens: [] }), /itens/)
  assert.equal(f.scans.length, 0)
  assert.ok(existsSync(staging))
})

test('skills_import of a marketplace plugin installs it with its store, with no second scan', async (t) => {
  const f = fixture(t, { itens, repo: MARKET_REPO })
  const r = (await f.call('skills_resolve', { origem: 'o/r' })) as { staging: string; kind: string; plugins: string[] }
  assert.equal(r.kind, 'marketplace')
  assert.deepEqual(r.plugins, ['p1', 'p2', 'p3'])
  await f.call('skills_import', { staging: r.staging, plugin: 'p1', itens: [{ nome: 'p1', descricao: 'Faz p1.', tags: [] }] })
  const want = { id: 'p1@loja-x', tipo: 'plugin', descricao: 'Faz p1.', tags: [], loja: 'o/r' }
  assert.deepEqual(f.installs, [{ id: 'p1@loja-x', item: want }])
  assert.deepEqual(f.scans, [r.staging])
  assert.equal(f.asks[0].summary, 'Instalar p1@loja-x de o/r e ligar neste projeto')
  assert.deepEqual(readCatalog(f.paths.lib).itens.find((i) => i.id === 'p1@loja-x'), want)
  assert.deepEqual(readList(f.project).list?.plugins, [{ id: 'p1@loja-x' }])
})

test('skills_import refuses a marketplace plugin whose code is outside the scanned folder', async (t) => {
  const f = fixture(t, { itens, repo: MARKET_REPO })
  const { staging } = (await f.call('skills_resolve', { origem: 'o/r' })) as { staging: string }
  await assert.rejects(f.call('skills_import', { staging, plugin: 'p2', itens: [{ nome: 'p2', descricao: 'x', tags: [] }] }), /outro repositório/)
  await assert.rejects(f.call('skills_import', { staging, plugin: 'p3', itens: [{ nome: 'p3', descricao: 'x', tags: [] }] }), /outro repositório/)
  await assert.rejects(f.call('skills_import', { staging, plugin: 'p9', itens: [{ nome: 'p9', descricao: 'x', tags: [] }] }), /p9 não está/)
  assert.equal(f.scans.length, 0)
  assert.equal(f.installs.length, 0)
})

test('skills_import refuses a store on a branch, or one this machine knows from another repo, before scanning', async (t) => {
  const p1 = { plugin: 'p1', itens: [{ nome: 'p1', descricao: 'Faz p1.', tags: [] }] }
  const f = fixture(t, { itens, repo: MARKET_REPO, knownMarkets: { 'loja-x': 'outro/dono' } })
  const known = (await f.call('skills_resolve', { origem: 'o/r' })) as { staging: string }
  await assert.rejects(f.call('skills_import', { staging: known.staging, ...p1 }), /loja-x já está registrada a partir de outro\/dono/)
  const g = fixture(t, { itens, repo: MARKET_REPO })
  const ref = (await g.call('skills_resolve', { origem: 'https://github.com/o/r/tree/dev' })) as { staging: string }
  await assert.rejects(g.call('skills_import', { staging: ref.staging, ...p1 }), /branch padrão/)
  assert.deepEqual([f.scans.length, f.installs.length, g.scans.length, g.installs.length], [0, 0, 0, 0])
  // the same repo, already registered, installs as usual
  const h = fixture(t, { itens, repo: MARKET_REPO, knownMarkets: { 'loja-x': 'O/R' } })
  const ok = (await h.call('skills_resolve', { origem: 'o/r' })) as { staging: string }
  await h.call('skills_import', { staging: ok.staging, ...p1 })
  assert.equal(h.installs.length, 1)
})
