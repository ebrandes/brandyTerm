import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { resolveCli } from '../adapters/proc.ts'
import { resolveCommand, runCheck } from './cli-command.ts'
import { fakeNpmBin } from './cli-shim-fixture.ts'

test('on Windows a .cmd shim runs as node and its script, with the arguments after', () => {
  const { dir, js } = fakeNpmBin()
  assert.deepEqual(resolveCommand(['railway', 'login'], `C:\\nada;${dir}`, 'win32'), ['node', js, 'login'])
})

test('on Windows a bundled node.exe next to the shim is used', () => {
  const { dir, js } = fakeNpmBin()
  fs.writeFileSync(join(dir, 'node.exe'), '')
  assert.deepEqual(resolveCommand(['railway', 'whoami'], dir, 'win32'), [join(dir, 'node.exe'), js, 'whoami'])
})

test('on Windows an .exe on PATH runs directly', () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'exe-'))
  fs.writeFileSync(join(dir, 'gh.exe'), '')
  assert.deepEqual(resolveCommand(['gh', 'auth', 'login'], dir, 'win32'), [join(dir, 'gh.exe'), 'auth', 'login'])
})

test('a command not on PATH stays as written, so its error names it', () => {
  const { dir } = fakeNpmBin()
  assert.deepEqual(resolveCommand(['nada', 'login'], dir, 'win32'), ['nada', 'login'])
})

test('macOS and Linux run the command exactly as written', () => {
  const { dir } = fakeNpmBin()
  fs.writeFileSync(join(dir, 'railway'), '')
  for (const platform of ['darwin', 'linux'] as const) assert.deepEqual(resolveCommand(['railway', 'login'], dir, platform), ['railway', 'login'])
})

test('resolveCli reads the PATH and platform it is given', () => {
  const { dir, js } = fakeNpmBin()
  assert.deepEqual(resolveCli('railway', { path: dir, platform: 'win32' }), { cmd: 'node', prefix: [js] })
  fs.writeFileSync(join(dir, 'railway'), '')
  assert.deepEqual(resolveCli('railway', { path: `/nada:${dir}`, platform: 'darwin' }), { cmd: join(dir, 'railway'), prefix: [] })
})

test('the login check runs the resolved command with the login PATH', async () => {
  const { dir, js } = fakeNpmBin()
  const seen: [string, string[], string | undefined][] = []
  const exec = async (file: string, args: string[], env: NodeJS.ProcessEnv) => { seen.push([file, args, env.PATH]); return 0 }
  assert.equal(await runCheck(['railway', 'whoami'], { path: dir, exec, platform: 'win32' }), 0)
  assert.equal(await runCheck(['railway', 'whoami'], { path: dir, exec, platform: 'darwin' }), 0)
  assert.deepEqual(seen, [['node', [js, 'whoami'], dir], ['railway', ['whoami'], dir]])
})
