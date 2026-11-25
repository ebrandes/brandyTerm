import { test } from 'node:test'
import assert from 'node:assert/strict'
import { failedText, portFailed } from './status.ts'

test('a failed port reads in Portuguese, with the usual causes named', () => {
  assert.equal(portFailed(7777), 'Não foi possível abrir a porta 7777')
  assert.equal(
    failedText(7777, 'listen EADDRINUSE: address already in use 0.0.0.0:7777'),
    'Não foi possível abrir a porta 7777: outro programa já usa essa porta.'
  )
  assert.equal(
    failedText(80, 'listen EACCES: permission denied 0.0.0.0:80'),
    'Não foi possível abrir a porta 80: sem permissão para usar essa porta.'
  )
  assert.equal(failedText(7777, 'boom'), 'Não foi possível abrir a porta 7777.')
})
