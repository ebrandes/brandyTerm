import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newKeyPair, toB64 } from '../shared/remote/crypto.ts'
import { claudeStream } from './adapters/claude-events.ts'
import { discoverCommands } from './commands.ts'
import { configureDiagLog, flushDiagLog, type DiagArea } from './diag-log.ts'
import { discoverPlugins, installPlugin } from './plugins.ts'
import { hostRunner } from './remote/runner.ts'
import { closed, exchange, pairMsg, withHost } from './remote/server-rig.ts'

type T = { after(fn: () => void): void }

function setup(t: T): (area: DiagArea) => Promise<any[]> {
  const dir = mkdtempSync(join(tmpdir(), 'diag-i-'))
  configureDiagLog({ dir, debug: false })
  t.after(() => {
    configureDiagLog(null)
    rmSync(dir, { recursive: true, force: true })
  })
  return async area => {
    await flushDiagLog()
    try {
      return readFileSync(join(dir, `${area}.log`), 'utf8').trim().split('\n').map(l => JSON.parse(l))
    } catch {
      return []
    }
  }
}

const find = (list: any[], level: string, msg: RegExp): any => {
  const hit = list.find(e => e.level === level && msg.test(e.msg))
  assert.ok(hit, `sem ${level} ${msg} em ${JSON.stringify(list.map(e => `${e.level} ${e.msg}`))}`)
  return hit
}

test('plugins: the load summary is logged once while it does not change', async t => {
  const read = setup(t)
  discoverPlugins()
  discoverPlugins()
  const log = await read('plugins')
  assert.equal(log.filter(e => e.msg === 'plugins carregados').length, 1)
})

test('plugins: a refused install is logged with its reason', async t => {
  const read = setup(t)
  await installPlugin('nao-existe')
  const e = find(await read('plugins'), 'error', /instalação falhou/)
  assert.deepEqual([e.data.id, e.data.error], ['nao-existe', 'plugin desconhecido'])
})

test('skills: discovery and a skill folder without SKILL.md are logged', async t => {
  const read = setup(t)
  const project = mkdtempSync(join(tmpdir(), 'diag-proj-'))
  t.after(() => rmSync(project, { recursive: true, force: true }))
  mkdirSync(join(project, '.claude', 'skills', 'boa'), { recursive: true })
  mkdirSync(join(project, '.claude', 'skills', 'quebrada'), { recursive: true })
  writeFileSync(join(project, '.claude', 'skills', 'boa', 'SKILL.md'), '---\nname: boa\n---\n')
  discoverCommands([], project)
  discoverCommands([], project)
  const log = await read('skills')
  assert.equal(log.filter(e => e.msg === 'skills descobertas').length, 1)
  assert.deepEqual(find(log, 'info', /descobertas/).data.names, ['boa'])
  assert.match(find(log, 'warn', /sem SKILL\.md/).data.dir, /quebrada$/)
})

test('skills: loading through the Skill tool logs success and failure', async t => {
  const read = setup(t)
  const stream = claudeStream(() => {}, 'conta')
  const use = (id: string, skill: string) => stream.handle({
    type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Skill', input: { skill, args: 'texto privado' } }] }
  })
  const result = (id: string, is_error: boolean, content: string) => stream.handle({
    type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error, content }] }
  })
  use('1', 'superpowers:brainstorming')
  result('1', false, 'ok')
  use('2', 'nao:existe')
  result('2', true, 'Unknown skill: nao:existe')
  const log = await read('skills')
  assert.equal(find(log, 'info', /skill carregada/).data.skill, 'superpowers:brainstorming')
  const failed = find(log, 'warn', /falha ao carregar skill/)
  assert.deepEqual([failed.data.skill, failed.data.error], ['nao:existe', 'Unknown skill: nao:existe'])
  assert.ok(!JSON.stringify(log).includes('texto privado'))
})

test('remote: a failure to start the server is logged', async t => {
  const read = setup(t)
  const original = console.error
  console.error = () => {}
  t.after(() => { console.error = original })
  const runner = hostRunner({
    desired: () => 1,
    make: () => ({ start: async () => { throw new Error('EADDRINUSE') }, stop: async () => {} })
  })
  await runner.sync()
  const e = find(await read('remote'), 'error', /não foi possível iniciar/)
  assert.deepEqual([e.data.port, e.data.error], [1, 'EADDRINUSE'])
})

const wrongCode = (code: string): string => (code.startsWith('0') ? '1' : '0') + code.slice(1)

test('remote: connect, refused call, disconnect, bad pairing and unknown key are logged', async t => {
  const read = setup(t)
  let code = ''
  await withHost(async e => {
    const ch = await e.connect()
    await ch.request('state:get', undefined)
    await assert.rejects(ch.request('settings:set', {}))
    await assert.rejects(ch.request('nada:existe', {}))
    const gone = closed(ch)
    ch.close()
    await gone
    await assert.rejects(e.connect(newKeyPair()))
    code = e.host.openPairing()
    const ws = await e.raw()
    await exchange(ws, pairMsg(wrongCode(code), newKeyPair()).text)
    await new Promise(r => setTimeout(r, 100))
    assert.ok(!JSON.stringify(await read('remote')).includes(toB64(e.client.pub)), 'chave inteira no log')
  })
  const log = await read('remote')
  find(log, 'info', /servidor ouvindo/)
  assert.equal(find(log, 'info', /dispositivo conectado/).data.name, 'Cliente')
  assert.equal(find(log, 'warn', /chamada falhou/).data.channel, 'settings:set')
  assert.equal(find(log, 'warn', /chamada recusada/).data.channel, 'nada:existe')
  find(log, 'info', /dispositivo desconectado/)
  find(log, 'warn', /autenticação falhou/)
  find(log, 'info', /pareamento aberto/)
  find(log, 'warn', /pareamento recusado/)
  find(log, 'info', /servidor parado/)
  assert.ok(!JSON.stringify(log).includes(code))
})
