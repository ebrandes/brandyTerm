import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { forPlatform, itemFor, readCatalog, upsertCatalog } from './catalog.ts'

const EXAMPLE = {
  versao: 1,
  itens: [
    { id: 'impeccable@impeccable', tipo: 'plugin', descricao: 'Acabamento.', tags: ['frontend', 'design'] },
    { id: 'hyperframes@claude-plugins-official', tipo: 'plugin', descricao: 'Vídeo.', tags: ['video'] },
    { id: 'graphify', tipo: 'skill', descricao: 'Grafo.', tags: ['docs'] },
    { id: 'kit-core@claude-kit', tipo: 'plugin', sempre: true, descricao: 'Base.', tags: [] },
    { id: 'vivo@claude-kit-private', tipo: 'plugin', corporativo: true, descricao: 'P3.', tags: ['vivo'] },
  ],
}

function lib(t: { after(fn: () => void): void }, body?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'catalog-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  if (body !== undefined) {
    mkdirSync(join(root, 'biblioteca'), { recursive: true })
    writeFileSync(join(root, 'biblioteca', 'catalogo.json'), body)
  }
  return root
}

test('readCatalog reads the spec example', (t) => {
  const { itens, erro } = readCatalog(lib(t, JSON.stringify(EXAMPLE)))
  assert.equal(erro, undefined)
  assert.equal(itens.length, 5)
  assert.equal(itens[3].sempre, true)
  assert.equal(itens[4].corporativo, true)
})

test('readCatalog: missing file is empty, no error', (t) => {
  assert.deepEqual(readCatalog(lib(t)), { itens: [] })
})

test('readCatalog: bad JSON reports the error', (t) => {
  assert.deepEqual(readCatalog(lib(t, '{nope')), { itens: [], erro: 'catalogo.json inválido' })
})

test('readCatalog drops items without id or tipo, keeps the rest', (t) => {
  const body = { versao: 1, itens: [{ tipo: 'plugin' }, { id: 'x' }, { id: 'y', tipo: 'nada' }, { id: 'ok', tipo: 'skill' }] }
  const { itens } = readCatalog(lib(t, JSON.stringify(body)))
  assert.deepEqual(itens.map((i) => i.id), ['ok'])
  assert.deepEqual(itens[0].tags, [])
  assert.equal(itens[0].descricao, '')
})

test('upsertCatalog writes sorted 2-space JSON with a trailing newline', (t) => {
  const root = lib(t, JSON.stringify(EXAMPLE))
  upsertCatalog(root, { id: 'aaa@loja', tipo: 'plugin', descricao: 'Novo.', tags: [], loja: 'dono/repo' })
  upsertCatalog(root, { id: 'graphify', tipo: 'skill', descricao: 'Trocado.', tags: [] })
  const raw = readFileSync(join(root, 'biblioteca', 'catalogo.json'), 'utf8')
  assert.ok(raw.endsWith('\n'))
  assert.ok(raw.includes('\n  "versao": 1'))
  const { itens } = readCatalog(root)
  assert.equal(itens.length, 6)
  assert.equal(itens[0].id, 'aaa@loja')
  assert.equal(itens[0].loja, 'dono/repo')
  assert.equal(itemFor(itens, 'graphify')?.descricao, 'Trocado.')
})

test('upsertCatalog creates the file when missing', (t) => {
  const root = lib(t)
  upsertCatalog(root, { id: 'g', tipo: 'skill', descricao: '', tags: [] })
  assert.equal(readCatalog(root).itens.length, 1)
})

test('itemFor finds by id', () => {
  assert.equal(itemFor([], 'x'), undefined)
})

test('forPlatform', () => {
  const base = { id: 'a', tipo: 'plugin' as const, descricao: '', tags: [] }
  assert.equal(forPlatform({ ...base, plataformas: ['mac'] }, 'win32'), false)
  assert.equal(forPlatform({ ...base, plataformas: ['mac'] }, 'darwin'), true)
  assert.equal(forPlatform({ ...base, plataformas: ['win'] }, 'win32'), true)
  assert.equal(forPlatform(base, 'win32'), true)
})
