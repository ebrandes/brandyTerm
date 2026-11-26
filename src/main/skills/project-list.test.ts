import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CatalogItem } from '../../shared/types.ts'
import { emptyList, listPath, readList, turnOff, turnOn, writeList } from './project-list.ts'

function project(t: { after(fn: () => void): void }, body?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'plist-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  if (body !== undefined) {
    mkdirSync(join(dir, '.brandyterm'), { recursive: true })
    writeFileSync(join(dir, '.brandyterm', 'skills.json'), body)
  }
  return dir
}

const plugin: CatalogItem = { id: 'impeccable@impeccable', tipo: 'plugin', descricao: '', tags: [] }
const skill: CatalogItem = { id: 'graphify', tipo: 'skill', descricao: '', tags: [] }
const base: CatalogItem = { id: 'kit-core@claude-kit', tipo: 'plugin', descricao: '', tags: [], sempre: true }

test('listPath', () => {
  assert.equal(listPath('/p'), join('/p', '.brandyterm', 'skills.json'))
})

test('readList: missing file is null with no error', (t) => {
  assert.deepEqual(readList(project(t)), { list: null })
})

test('readList: bad JSON reports the error', (t) => {
  assert.deepEqual(readList(project(t, '[oops')), { list: null, erro: 'skills.json inválido' })
})

test('readList: missing arrays default to empty, bad entries dropped', (t) => {
  const { list } = readList(project(t, JSON.stringify({ versao: 1, plugins: [{ id: 'a', ref: 'r1' }, { nope: 1 }, 'b'] })))
  assert.deepEqual(list, { versao: 1, plugins: [{ id: 'a', ref: 'r1' }], skills: [], sem: [] })
})

test('turnOn plugin adds it and clears it from sem, without duplicates', () => {
  let l = { ...emptyList(), sem: [plugin.id] }
  l = turnOn(turnOn(l, plugin), plugin)
  assert.deepEqual(l.plugins, [{ id: plugin.id }])
  assert.deepEqual(l.sem, [])
})

test('turnOn skill adds it to skills, without duplicates', () => {
  const l = turnOn(turnOn(emptyList(), skill), skill)
  assert.deepEqual(l.skills, ['graphify'])
  assert.deepEqual(l.plugins, [])
})

test('turnOn on a sempre item only clears sem', () => {
  const l = turnOn({ ...emptyList(), sem: [base.id] }, base)
  assert.deepEqual(l.sem, [])
  assert.deepEqual(l.plugins, [])
})

test('turnOff removes listed items and puts sempre items in sem', () => {
  const on = turnOn(turnOn(emptyList(), plugin), skill)
  const off = turnOff(turnOff(on, plugin), skill)
  assert.deepEqual(off.plugins, [])
  assert.deepEqual(off.skills, [])
  const noBase = turnOff(turnOff(emptyList(), base), base)
  assert.deepEqual(noBase.sem, [base.id])
})

test('writeList then readList round-trips, ends with a newline, creates .brandyterm', (t) => {
  const dir = project(t)
  const l = turnOn(turnOn(emptyList(), plugin), skill)
  writeList(dir, l)
  assert.deepEqual(readList(dir).list, l)
  assert.ok(readFileSync(listPath(dir), 'utf8').endsWith('\n'))
})
