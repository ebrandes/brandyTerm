import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectorView } from './view.ts'
import type { Connector, ConnectorStatus } from '../../shared/connectors.ts'

const token: Connector = {
  id: 'g', name: 'GitHub', description: '', transport: 'http', url: 'https://x', enabled: true, alwaysAllow: [],
  auth: { kind: 'token', fields: [{ key: 'token', label: 'Token', use: { header: 'Authorization', format: 'Bearer {value}' } }] },
}
const hubAt = (status: ConnectorStatus) => ({ status: () => ({ status }) })
const login = (missing: boolean) => ({ needsLoginNow: () => missing })

test('the initial status of a token connector with no secret is precisa de login', () => {
  const v = connectorView(token, hubAt('desconectado'), login(true))
  assert.equal(v.status, 'precisa de login')
  assert.equal(v.authKind, 'token')
  assert.equal('auth' in v, false)
})

test('a token connector with its secret stays desconectado until it connects', () => {
  assert.equal(connectorView(token, hubAt('desconectado'), login(false)).status, 'desconectado')
})

test('a live hub status always wins', () => {
  for (const s of ['conectado', 'erro', 'precisa de login'] as const) assert.equal(connectorView(token, hubAt(s), login(true)).status, s)
})
