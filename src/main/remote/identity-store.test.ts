import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { identityStore } from './identity-store.ts'

const tmp = (t: { after(fn: () => void): void }) => {
  const d = fs.mkdtempSync(join(os.tmpdir(), 'ident-'))
  t.after(() => fs.rmSync(d, { recursive: true, force: true }))
  return d
}

test('first load creates machine.json; later loads read it back', t => {
  const file = join(tmp(t), 'machine.json')
  const a = identityStore(() => file, 'darwin', () => 'mac-mini').load()
  assert.equal(a.os, 'mac')
  assert.ok(a.id && a.name)
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(saved.id, a.id)
  assert.equal(identityStore(() => file, 'darwin', () => 'outro').load().id, a.id)
})

test('a machine.json that cannot be written never fails startup: the identity stays in memory', t => {
  const dir = tmp(t)
  const file = join(dir, 'machine.json')
  fs.mkdirSync(file) // a folder where the file should be: every write throws
  const errors: string[] = []
  const store = identityStore(() => file, 'linux', () => 'box', m => errors.push(m))
  const a = store.load()
  assert.ok(a.id)
  assert.equal(store.load(), a, 'same identity for the whole run')
  assert.equal(store.rename('  Servidor  ').name, 'Servidor')
  assert.equal(store.load().name, 'Servidor')
  assert.equal(errors.length, 2)
  assert.match(errors[0], /machine\.json/)
})
