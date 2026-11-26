import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gatewayFor, gatewaySpec, setGatewayProvider } from './gateway-launch.ts'

test('no provider, or no thread, means no gateway', () => {
  assert.equal(gatewayFor({ projectId: 'p', threadId: 't' }), null)
  setGatewayProvider(() => gatewaySpec('/s', '/tok'))
  assert.equal(gatewayFor(undefined), null)
})

test('the spec carries only the three gateway env vars', () => {
  const spec = gatewayFor({ projectId: 'p', threadId: 't' })!
  assert.equal(spec.command, process.execPath)
  assert.match(spec.args[0], /gateway\.js$/)
  assert.deepEqual(spec.env, { ELECTRON_RUN_AS_NODE: '1', BRANDY_GATEWAY_SOCKET: '/s', BRANDY_GATEWAY_TOKEN_FILE: '/tok' })
})
