import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readOpen, sideKey, writeOpen, type KeyStore } from './side-state.ts'
import { readyLabel, remoteLabel, usageLine } from './side-summary.ts'

const memory = (): KeyStore & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

test('section state round-trips under brandy.side.<id>', () => {
  const s = memory()
  assert.equal(readOpen(s, 'agents'), false)
  writeOpen(s, 'agents', true)
  assert.equal(s.data.get(sideKey('agents')), '1')
  assert.equal(readOpen(s, 'agents'), true)
  writeOpen(s, 'agents', false)
  assert.equal(readOpen(s, 'agents', true), false)
})

test('missing, odd or broken storage falls back', () => {
  const broken: KeyStore = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('full')
    }
  }
  assert.equal(readOpen(broken, 'x', true), true)
  assert.doesNotThrow(() => writeOpen(broken, 'x', true))
  assert.equal(readOpen(undefined, 'x'), false)
  const s = memory()
  s.setItem(sideKey('x'), 'yes')
  assert.equal(readOpen(s, 'x', true), true)
})

test('header and card summaries', () => {
  assert.equal(readyLabel(1), '1 pronto')
  assert.equal(readyLabel(3), '3 prontos')
  assert.equal(usageLine(2, 1), '5h 2% · sem 1%')
  assert.equal(usageLine(undefined, 40), '5h 0% · sem 40%')
  assert.equal(remoteLabel(false, 'on'), 'desligado')
  assert.equal(remoteLabel(true, 'on'), 'ligado')
  assert.equal(remoteLabel(true, 'failed'), 'falhou')
  assert.equal(remoteLabel(true, 'off'), 'iniciando…')
})
