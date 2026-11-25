import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authorize, filterState, projectOf, HIDDEN } from './host-filter.ts'
import { RULES } from '../rpc/channels.ts'
import type { AppState, Project } from '../../shared/types.ts'

const proj = (id: string, over: Partial<Project> = {}) => ({ id, name: id, ...over }) as Project

function state(): AppState {
  return {
    projects: [proj('a'), proj('b', { remoteHidden: true })],
    agents: [], plugins: [],
    accounts: {
      list: [{ id: 'x', label: 'Conta', kind: 'token', token: 'sk-ant-xyz', error: 'boom' } as never],
      activeId: 'x', autoSwitch: true
    },
    settings: { keepAwake: true, lastSeen: { a: 'now' }, lastProjectId: 'a', remote: { enabled: true, port: 1 }, secretNew: 'x' } as never
  }
}

test('filterState drops hidden projects, secrets and local settings', () => {
  const out = filterState(state())
  assert.deepEqual(out.projects.map(p => p.id), ['a'])
  const json = JSON.stringify(out)
  assert.ok(!json.includes('sk-ant-xyz'))
  assert.equal(out.settings?.lastSeen, undefined)
  assert.equal(out.settings?.lastProjectId, undefined)
  assert.equal(out.settings?.keepAwake, true)
  assert.ok(!('secretNew' in (out.settings ?? {})))
  assert.ok(!('remote' in (out.settings ?? {})))
  assert.equal(out.accounts?.list[0].label, 'Conta')
})

test('filterState is an allowlist: plugins, the machine and any new field stay on the host', () => {
  const s = {
    ...state(),
    plugins: [{ id: 'rtk', name: 'RTK', kind: 'tool', path: '/Users/eu/.rtk', report: '/Users/eu/rtk.md' }],
    machine: { id: 'm', name: 'Mac do Eu', os: 'mac' },
    secretTop: 'x'
  } as unknown as AppState
  const out = filterState(s)
  assert.deepEqual(Object.keys(out).sort(), ['accounts', 'agents', 'plugins', 'projects', 'settings'])
  assert.deepEqual(out.plugins, [])
  assert.ok(!JSON.stringify(out).includes('/Users/eu'))
  assert.ok(!JSON.stringify(out).includes('Mac do Eu'))
})

test('filterState does not mutate its input', () => {
  const s = state()
  filterState(s)
  assert.equal(s.projects.length, 2)
  assert.ok(s.settings?.lastSeen)
})

test('projectOf', () => {
  assert.equal(projectOf('chat:send', { projectId: 'p1' }), 'p1')
  assert.equal(projectOf('commands:list', 'p2'), 'p2')
  assert.equal(projectOf('term:write', { id: 'p3', data: 'x' }), 'p3')
  assert.equal(projectOf('term:kill', 'p4'), 'p4')
  assert.equal(projectOf('archive:list', ['a']), null)
  assert.equal(projectOf('chat:send', { projectId: ['b'] }), null)
  assert.equal(projectOf('state:get', undefined), null)
})

test('authorize: hidden or malformed project ids are refused on every scoped channel', () => {
  const s = state()
  const bad: [string, unknown][] = []
  for (const v of [['b'], 'b', 'zzz', 7, undefined, null, {}, { id: 'b' }]) {
    bad.push(['commands:list', v], ['project:remove', v], ['term:kill', v])
    for (const ch of ['chat:send', 'fs:list', 'artifact:read', 'process:start', 'attach:save', 'thread:cancel']) bad.push([ch, { projectId: v }])
    for (const ch of ['term:open', 'term:write', 'term:resize']) bad.push([ch, { id: v }])
  }
  bad.push(['chat:send', undefined], ['term:open', 'a'], ['chat:send', 'a'])
  for (const [ch, arg] of bad) {
    const wantOk = (ch === 'commands:list' || ch === 'project:remove' || ch === 'term:kill') && arg === 'a'
    assert.equal(authorize(ch, arg, s).ok, wantOk, `${ch} ${JSON.stringify(arg)}`)
  }
  assert.deepEqual(authorize('chat:send', { projectId: ['b'] }, s), { ok: false, error: HIDDEN })
  assert.deepEqual(authorize('commands:list', ['b'], s), { ok: false, error: HIDDEN })
  assert.deepEqual(authorize('term:open', { id: ['b'] }, s), { ok: false, error: HIDDEN })
})

test('authorize: visible ids pass, unscoped allowlist passes, unknown channels are refused', () => {
  const s = state()
  assert.deepEqual(authorize('chat:send', { projectId: 'a' }, s), { ok: true, arg: { projectId: 'a' } })
  assert.equal(authorize('term:write', { id: 'a' }, s).ok, true)
  assert.equal(authorize('term:kill', { id: 'a' }, s).ok, true)
  assert.equal(authorize('settings:set', undefined, s).ok, true)
  assert.equal(authorize('state:get', undefined, s).ok, true)
  assert.equal(authorize('mystery:channel', { projectId: 'a' }, s).ok, false)
})

test('authorize: archive:list keeps only visible string ids', () => {
  const s = state()
  assert.deepEqual(authorize('archive:list', ['a', 'b', 'q', 7, ['a']], s), { ok: true, arg: ['a'] })
  assert.deepEqual(authorize('archive:list', 'a', s), { ok: true, arg: [] })
})

test('authorize knows every registered channel (none falls into the unknown refusal by accident)', () => {
  const s = state()
  for (const ch of Object.keys(RULES)) {
    // connectors:* are deny and deliberately in neither SCOPED nor UNSCOPED: the host refuses them as unknown
    if (ch.startsWith('connectors:')) {
      assert.deepEqual(authorize(ch, { id: 'x' }, s), { ok: false, error: HIDDEN }, ch)
      continue
    }
    const viaProject = authorize(ch, { projectId: 'a', id: 'a' }, s)
    const viaString = authorize(ch, 'a', s)
    const viaNothing = authorize(ch, undefined, s)
    assert.ok(viaProject.ok || viaString.ok || viaNothing.ok, ch)
  }
})

function withPlugins(): AppState {
  const s = state()
  s.projects[0].path = '/work/a'
  s.projects[1].path = '/work/b'
  s.userPlugins = {
    list: [
      { id: 'u@m', name: 'u', scope: 'user' },
      { id: 'pa@m#/work/a', name: 'pa', scope: 'project' },
      { id: 'pb@m#/work/b', name: 'pb', scope: 'project' },
      { id: 'px@m#/work/unknown', name: 'px', scope: 'project' }
    ] as never,
    personal: undefined
  }
  return s
}

test('filterState drops project plugins of hidden or unknown projects', () => {
  const out = filterState(withPlugins())
  assert.deepEqual(out.userPlugins?.list.map(u => u.id), ['u@m', 'pa@m#/work/a'])
  assert.ok(!JSON.stringify(out).includes('/work/b'))
  assert.ok(!JSON.stringify(out).includes('/work/unknown'))
})

test('authorize userPlugins:set: project plugins only for visible projects', () => {
  const s = withPlugins()
  const ok = (id: unknown) => authorize('userPlugins:set', { id, on: true }, s).ok
  assert.equal(ok('u@m'), true)
  assert.equal(ok('personal'), true)
  assert.equal(ok('pa@m#/work/a'), true)
  assert.equal(ok('pb@m#/work/b'), false)
  assert.equal(ok('px@m#/work/unknown'), false)
  assert.equal(ok(['pb@m#/work/b']), false)
  assert.equal(ok(undefined), false)
  assert.deepEqual(authorize('userPlugins:set', { id: 'pb@m#/work/b' }, s), { ok: false, error: HIDDEN })
})

test('authorize fs:list: remote queries stay inside the project', () => {
  const s = state()
  const q = (query: unknown) => authorize('fs:list', { projectId: 'a', query }, s)
  for (const query of ['/', '/etc/', '~/', '~', '../x', 'a/../../x', '..\\x', ['/']]) {
    assert.deepEqual(q(query), { ok: false, error: 'Fora do projeto' }, JSON.stringify(query))
  }
  for (const query of ['', 'src/ma', 'a..b', 'file.ts']) assert.equal(q(query).ok, true, query)
  assert.equal(authorize('fs:list', { projectId: 'b', query: 'x' }, s).ok, false)
})

test('remote state has no connector command, args, url, envKeys, headerKeys, projects or logins', () => {
  const s = {
    ...state(),
    connectors: {
      list: [{
        id: 'c1', name: 'Railway', description: 'd', transport: 'stdio', command: '/Users/eu/bin/railway', args: ['mcp', '--token=sk-1'],
        url: 'https://secret.example/mcp', envKeys: ['RAILWAY_TOKEN'], headerKeys: ['Authorization'], projects: ['/Users/eu/p'],
        authKind: 'cli', enabled: true, preset: 'railway', alwaysAllow: ['get_logs'], status: 'conectado', error: 'boom /Users/eu', toolCount: 12
      }],
      logins: [{ connectorId: 'c1', name: 'Railway', phase: 'ask', authKind: 'cli', panel: true, terminalId: 'connector-login-c1' }]
    }
  } as unknown as AppState
  const out = filterState(s)
  assert.deepEqual(out.connectors, {
    list: [{ id: 'c1', name: 'Railway', description: 'd', preset: 'railway', enabled: true, status: 'conectado', toolCount: 12 }],
    logins: []
  })
  const json = JSON.stringify(out)
  for (const leak of ['bin/railway', '--token', 'secret.example', 'RAILWAY_TOKEN', 'Authorization', '/Users/eu', 'get_logs', 'boom']) {
    assert.ok(!json.includes(leak), leak)
  }
})

test('a state without connectors stays without connectors', () => {
  assert.equal(filterState(state()).connectors, undefined)
})
