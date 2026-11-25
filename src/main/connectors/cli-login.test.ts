import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runCliLogin } from './cli-login.ts'
import type { Connector } from '../../shared/connectors.ts'

const railway: Connector = {
  id: 'railway', name: 'Railway', description: '', transport: 'stdio', command: 'railway', enabled: true, alwaysAllow: [],
  auth: { kind: 'cli', command: ['railway', 'login'], check: ['railway', 'whoami'] },
}
const path = async () => '/fake/bin'

function deps(exit: number | Error, check = 0) {
  const calls = { spawn: [] as { id: string; file: string; args: string[]; cwd: string; env?: Record<string, string> }[], exec: [] as string[][], killed: 0 }
  return {
    calls,
    d: {
      path,
      spawn: (id: string, o: { file: string; args: string[]; cwd: string; env?: Record<string, string>; onExit: (code: number) => void }) => {
        if (exit instanceof Error) throw exit
        calls.spawn.push({ id, file: o.file, args: o.args, cwd: o.cwd, env: o.env })
        setImmediate(() => o.onExit(exit))
        return { kill: () => { calls.killed++ } }
      },
      exec: async (cmd: string[]) => { calls.exec.push(cmd); return check },
    },
  }
}

test('exit 0 and check 0 resolve; runs the command in the login terminal from home with the login PATH', async () => {
  const { calls, d } = deps(0)
  await runCliLogin(railway, 'connector-login-railway', new AbortController().signal, d)
  assert.equal(calls.spawn[0].id, 'connector-login-railway')
  assert.equal(calls.spawn[0].file, 'railway')
  assert.deepEqual(calls.spawn[0].args, ['login'])
  assert.equal(calls.spawn[0].cwd, (await import('node:os')).homedir())
  assert.equal(calls.spawn[0].env?.PATH, '/fake/bin')
  assert.deepEqual(calls.exec, [['railway', 'whoami']])
})

test('exit 1 rejects and never runs the check', async () => {
  const { calls, d } = deps(1)
  await assert.rejects(runCliLogin(railway, 'connector-login-railway', new AbortController().signal, d), /Login do Railway não terminou/)
  assert.equal(calls.exec.length, 0)
})

test('check failing after exit 0 rejects', async () => {
  const { d } = deps(0, 1)
  await assert.rejects(runCliLogin(railway, 'connector-login-railway', new AbortController().signal, d), /Login do Railway não foi confirmado/)
})

test('no check: exit 0 is enough', async () => {
  const { calls, d } = deps(0)
  const c = { ...railway, auth: { kind: 'cli' as const, command: ['railway', 'login'] } }
  await runCliLogin(c, 'connector-login-railway', new AbortController().signal, d)
  assert.equal(calls.exec.length, 0)
})

test('spawn ENOENT names the missing CLI', async () => {
  const err = Object.assign(new Error('spawn railway ENOENT'), { code: 'ENOENT' })
  const { d } = deps(err)
  await assert.rejects(
    runCliLogin(railway, 'connector-login-railway', new AbortController().signal, d),
    /Comando railway não encontrado\. Instale o CLI e tente de novo\./,
  )
})

test('abort kills the pty and rejects', async () => {
  const calls = { killed: 0 }
  const ac = new AbortController()
  const d = {
    path,
    spawn: () => ({ kill: () => { calls.killed++ } }),
    exec: async () => 0,
  }
  const p = runCliLogin(railway, 'connector-login-railway', ac.signal, d)
  await new Promise(r => setImmediate(r))
  ac.abort()
  await assert.rejects(p, /login do Railway cancelado/)
  assert.equal(calls.killed, 1)
})

test('aborted before the spawn: nothing is spawned', async () => {
  const ac = new AbortController()
  ac.abort()
  const { calls, d } = deps(0)
  await assert.rejects(runCliLogin(railway, 'connector-login-railway', ac.signal, d), /cancelado/)
  assert.equal(calls.spawn.length, 0)
})
