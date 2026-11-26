import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readGatewayToken, writeTokenFile } from './gateway-token.ts'

test('the token travels in a private file whose name does not reveal it', () => {
  const root = mkdtempSync(join(tmpdir(), 'brandy-tok-'))
  const file = writeTokenFile(join(root, 'gw'), 'segredo-abc')
  assert.equal(file.includes('segredo'), false)
  assert.equal(writeTokenFile(join(root, 'gw'), 'segredo-abc'), file)
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.equal(readGatewayToken({ BRANDY_GATEWAY_TOKEN_FILE: file }), 'segredo-abc')
  rmSync(root, { recursive: true })
})

test('a missing token file gives an empty token', () => {
  assert.equal(readGatewayToken({ BRANDY_GATEWAY_TOKEN_FILE: '/nao/existe' }), '')
})
