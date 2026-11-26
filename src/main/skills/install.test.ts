import test from 'node:test'
import assert from 'node:assert/strict'
import type { CatalogItem } from '../../shared/types.ts'
import type { ScanResult } from '../security.ts'
import { installPlugin } from './install.ts'

function fakes(o: { code?: Record<string, number>; scan?: ScanResult } = {}) {
  const runs: string[][] = []
  const scans: string[] = []
  return {
    runs,
    scans,
    run: async (args: string[]) => {
      runs.push(args)
      return { code: o.code?.[args[1]] ?? 0, out: o.code?.[args[1]] ? 'falhou feio' : '' }
    },
    scan: async (spec: string) => {
      scans.push(spec)
      return o.scan ?? { ok: true, counts: { LOW: 1 }, blocked: false }
    },
  }
}

const item = (id: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({ id, tipo: 'plugin', descricao: '', tags: [], ...extra })

test('catalog item, known store: only install, no scan', async () => {
  const f = fakes()
  const r = await installPlugin('imp@impeccable', { item: item('imp@impeccable'), knownMarkets: new Set(['impeccable']), ...f })
  assert.deepEqual(r, { ok: true })
  assert.deepEqual(f.runs, [['plugin', 'install', 'imp@impeccable', '--scope', 'user']])
  assert.deepEqual(f.scans, [])
})

test('catalog item, unknown store with loja: marketplace add, then install', async () => {
  const f = fakes()
  const r = await installPlugin('x@loja', { item: item('x@loja', { loja: 'dono/loja' }), knownMarkets: new Set(), ...f })
  assert.equal(r.ok, true)
  assert.deepEqual(f.runs, [
    ['plugin', 'marketplace', 'add', 'dono/loja'],
    ['plugin', 'install', 'x@loja', '--scope', 'user'],
  ])
})

test('unknown store without loja is refused', async () => {
  const f = fakes()
  const r = await installPlugin('x@nada', { item: item('x@nada'), knownMarkets: new Set(), ...f })
  assert.deepEqual(r, { ok: false, erro: 'Loja nada desconhecida: rode /skill-install com o repositório dela.' })
  assert.deepEqual(f.runs, [])
})

test('not in the catalog: scan first; blocked never installs', async () => {
  const f = fakes({ scan: { ok: true, counts: { HIGH: 2, LOW: 1 }, blocked: true } })
  const r = await installPlugin('evil@s', { knownMarkets: new Set(['s']), ...f })
  assert.deepEqual(r, { ok: false, erro: 'Bloqueado pela checagem de segurança: 2 HIGH, 1 LOW' })
  assert.deepEqual(f.scans, ['evil@s'])
  assert.deepEqual(f.runs, [])
})

test('not in the catalog and clean: scan, then install', async () => {
  const f = fakes()
  const r = await installPlugin('ok@s', { knownMarkets: new Set(['s']), ...f })
  assert.equal(r.ok, true)
  assert.deepEqual(f.scans, ['ok@s'])
  assert.deepEqual(f.runs, [['plugin', 'install', 'ok@s', '--scope', 'user']])
})

test('a failed scan blocks with its error', async () => {
  const f = fakes({ scan: { ok: false, counts: {}, blocked: true, error: 'sem rede' } })
  const r = await installPlugin('a@s', { knownMarkets: new Set(['s']), ...f })
  assert.deepEqual(r, { ok: false, erro: 'Bloqueado pela checagem de segurança: scan falhou: sem rede' })
})

test('a corporate item is never scanned', async () => {
  const f = fakes()
  const corp = item('vivo@claude-kit-private', { corporativo: true })
  const r = await installPlugin(corp.id, { item: corp, knownMarkets: new Set(['claude-kit-private']), ...f })
  assert.equal(r.ok, true)
  assert.deepEqual(f.scans, [])
})

test('a failed install reports the CLI output', async () => {
  const f = fakes({ code: { install: 1 } })
  const r = await installPlugin('a@s', { item: item('a@s'), knownMarkets: new Set(['s']), ...f })
  assert.deepEqual(r, { ok: false, erro: 'falhou feio' })
})

test('an id without a store is refused', async () => {
  const f = fakes()
  assert.equal((await installPlugin('semloja', { knownMarkets: new Set(), ...f })).ok, false)
  assert.deepEqual(f.runs, [])
})
