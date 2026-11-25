import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PanelLogin } from '../../../shared/connectors.ts'
import { loginCardView } from './login-card-view.ts'

const base: PanelLogin = { connectorId: 'c1', name: 'Railway', phase: 'ask', authKind: 'oauth', panel: true }

test('local ask: Entrar enabled, Cancelar shown', () => {
  const v = loginCardView(base, false)
  assert.equal(v.title, 'Conectar Railway')
  assert.deepEqual(v.primary, { label: 'Entrar', disabled: false })
  assert.equal(v.cancel, true)
})

test('waiting: note, no primary, Cancelar', () => {
  const v = loginCardView({ ...base, phase: 'waiting' }, false)
  assert.equal(v.note, 'Aguardando login…')
  assert.equal(v.primary, undefined)
  assert.equal(v.cancel, true)
})

test('the cli kind shows its terminal while waiting', () => {
  assert.equal(loginCardView({ ...base, authKind: 'cli', phase: 'waiting' }, false).showTerminal, true)
  assert.equal(loginCardView({ ...base, authKind: 'oauth', phase: 'waiting' }, false).showTerminal, false)
})

test('the token kind shows its fields in ask', () => {
  assert.equal(loginCardView({ ...base, authKind: 'token', fields: [{ key: 'k', label: 'Token' }] }, false).showFields, true)
  assert.equal(loginCardView({ ...base, authKind: 'token', phase: 'waiting' }, false).showFields, false)
})

test('remote ask: Faça login em <máquina>, disabled, no Cancelar', () => {
  const v = loginCardView(base, true, 'PC')
  assert.deepEqual(v.primary, { label: 'Faça login em PC', disabled: true })
  assert.equal(v.cancel, false)
})

test('failed: the error as note and Tentar de novo', () => {
  const v = loginCardView({ ...base, phase: 'failed', error: 'deu ruim' }, false)
  assert.equal(v.note, 'deu ruim')
  assert.deepEqual(v.primary, { label: 'Tentar de novo', disabled: false })
})

test('a panel-started cli login shows its terminal in the panel card only', () => {
  const w: PanelLogin = { ...base, authKind: 'cli', phase: 'waiting', panel: true }
  assert.equal(loginCardView(w, false, undefined, 'panel').showTerminal, true)
  const t = loginCardView(w, false, undefined, 'thread')
  assert.equal(t.showTerminal, false)
  assert.equal(t.note, 'Aguardando login…')
  assert.equal(t.cancel, true)
})

test('a thread-only cli login shows its terminal in the thread card only', () => {
  const w: PanelLogin = { ...base, authKind: 'cli', phase: 'waiting', panel: false }
  assert.equal(loginCardView(w, false, undefined, 'thread').showTerminal, true)
  assert.equal(loginCardView(w, false, undefined, 'panel').showTerminal, false)
})
