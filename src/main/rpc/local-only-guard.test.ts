import { test } from 'node:test'
import assert from 'node:assert/strict'
import { local } from './local-only-guard.ts'

test('local handlers run for the window and refuse any remote call before touching anything', () => {
  let ran = 0
  const h = local((a: number) => { ran++; return a + 1 })
  assert.equal(h(1, {} as never), 2)
  assert.throws(() => h(1, { remote: { deviceId: 'd', terminal: true } } as never), /Terminal remoto chega numa próxima versão/)
  assert.equal(ran, 1)
})
