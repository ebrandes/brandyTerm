import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectorDot } from './connector-dot.ts'

const app = { name: 'app', path: '/p/app' }
const site = { name: 'site', path: '/p/site' }
const c = (over: Partial<Parameters<typeof connectorDot>[0]> = {}) =>
  ({ name: 'Context7', status: 'conectado' as const, enabled: true, ...over })

test('gray when it is not connected, whatever the project', () => {
  for (const status of ['desconectado', 'precisa de login', 'erro'] as const) {
    assert.equal(connectorDot(c({ status }), app).tone, 'off')
    assert.equal(connectorDot(c({ status, enabled: false }), app).tone, 'off')
  }
  assert.equal(connectorDot(c({ status: 'desconectado' }), app).label, 'Context7: desconectado')
  assert.equal(connectorDot(c({ status: 'precisa de login' })).label, 'Context7: precisa de login')
})

test('gray with the error message in the label', () => {
  const d = connectorDot(c({ status: 'erro', error: 'initialize: timeout' }), app)
  assert.deepEqual(d, { tone: 'off', label: 'Context7: com erro: initialize: timeout' })
  assert.equal(connectorDot(c({ status: 'erro' }), app).label, 'Context7: com erro')
})

test('green when connected and on in every project', () => {
  assert.deepEqual(connectorDot(c(), app), { tone: 'on', label: 'Context7: conectado e habilitado em app' })
  assert.equal(connectorDot(c({ projects: [] }), site).tone, 'on')
})

test('limited to some projects: green only in those, yellow elsewhere', () => {
  const limited = c({ projects: ['/p/app'] })
  assert.equal(connectorDot(limited, app).tone, 'on')
  assert.deepEqual(connectorDot(limited, site), { tone: 'idle', label: 'Context7: conectado, mas não habilitado em site' })
})

test('switching projects changes the color', () => {
  const limited = c({ projects: ['/p/site'] })
  assert.deepEqual([app, site, app].map((p) => connectorDot(limited, p).tone), ['idle', 'on', 'idle'])
})

test('yellow when connected but switched off', () => {
  assert.deepEqual(connectorDot(c({ enabled: false }), app), { tone: 'idle', label: 'Context7: conectado, mas desligado' })
  assert.equal(connectorDot(c({ enabled: false, projects: ['/p/app'] }), app).tone, 'idle')
})

test('a project without a folder is outside any limit', () => {
  const demo = { name: 'demo', path: null }
  assert.equal(connectorDot(c({ projects: ['/p/app'] }), demo).tone, 'idle')
  assert.equal(connectorDot(c(), demo).tone, 'on')
})

test('a project on another machine never uses this one\'s connectors', () => {
  const remote = { ...app, elsewhere: 'notebook' }
  assert.deepEqual(connectorDot(c(), remote), { tone: 'idle', label: 'Context7: conectado, mas não usado em app: roda em notebook' })
})

test('no project in view: green unless off or limited', () => {
  assert.deepEqual(connectorDot(c()), { tone: 'on', label: 'Context7: conectado' })
  assert.equal(connectorDot(c({ projects: ['/p/app'] })).tone, 'idle')
  assert.equal(connectorDot(c({ enabled: false })).tone, 'idle')
})

test('global with an exception: yellow only there, green in any other project, new ones included', () => {
  const global = c({ exceptProjects: ['/p/app'] })
  assert.deepEqual(connectorDot(global, app), { tone: 'idle', label: 'Context7: conectado, mas não habilitado em app (exceção)' })
  assert.equal(connectorDot(global, site).tone, 'on')
  assert.equal(connectorDot(global, { name: 'novo', path: '/p/novo' }).tone, 'on')
  assert.equal(connectorDot(global).tone, 'on')
})
