import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ECONOMIZER_FILES } from './adapters/codex-hooks.ts'
import { economizerProblem, findPython, planInjection, userHasEconomizer, type Machine } from './codex-economy.ts'

const root = mkdtempSync(join(tmpdir(), 'brandy-eco-'))
for (const f of ECONOMIZER_FILES) {
  mkdirSync(dirname(join(root, f)), { recursive: true })
  writeFileSync(join(root, f), f.endsWith('.json') ? '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"s"}]}]}}' : '')
}
process.on('exit', () => rmSync(root, { recursive: true, force: true }))

const ok: Machine = { platform: 'darwin', codexVersion: 'codex-cli 0.171.0', python: true, userPlugin: false, rtkBin: '/rtk', rtkHook: 'unapproved' }
const run = { tools: 'work' as const, plugins: [root] }
const has = (a: string[], s: string) => a.some((x) => x.startsWith(s))

test('a thread run gets the TokenEconomizer and RTK', () => {
  const r = planInjection(run, ok)
  assert.ok(has(r.args, 'hooks.Stop=') && has(r.args, 'hooks.PreToolUse='))
  assert.deepEqual(r.env, { PLUGIN_ROOT: root })
})

test('an RTK hook the user already approved is not injected twice', () => {
  const r = planInjection(run, { ...ok, rtkHook: 'approved' })
  assert.ok(has(r.args, 'hooks.Stop=') && !has(r.args, 'hooks.PreToolUse='))
})

test('without Python or with the plugin installed in Codex itself, only RTK goes', () => {
  for (const m of [{ ...ok, python: false }, { ...ok, userPlugin: true }]) {
    const r = planInjection(run, m)
    assert.ok(!has(r.args, 'hooks.Stop=') && has(r.args, 'hooks.PreToolUse='))
    assert.deepEqual(r.env, {})
  }
})

test('nothing goes to an unverified Codex; runs without tools get no RTK', () => {
  for (const codexVersion of ['codex-cli 0.170.9', null]) assert.deepEqual(planInjection(run, { ...ok, codexVersion }), { args: [], env: {} })
  assert.deepEqual(planInjection({ tools: 'none' }, ok), { args: [], env: {} })
})

test('the health problem names what is missing', () => {
  assert.equal(economizerProblem(root, ok), null)
  assert.equal(economizerProblem(root, { ...ok, codexVersion: 'codex-cli 1.0.0' }), null)
  assert.match(economizerProblem(undefined, ok)!, /npm run plugins/)
  assert.match(economizerProblem('/nao/existe', ok)!, /npm run plugins/)
  assert.match(economizerProblem(root, { ...ok, python: false })!, /Python 3\.10\+ não encontrado/)
  assert.match(economizerProblem(root, { ...ok, codexVersion: 'codex-cli 0.150.0' })!, /0\.150\.0 .*0\.171\.0/)
  assert.match(economizerProblem(root, { ...ok, userPlugin: true })!, /instalado no próprio Codex/)
})

test('Python is looked up the way the plugin launches it', () => {
  const tried: string[] = []
  const probe = (name: string) => (tried.push(name), name === 'python3.12')
  assert.equal(findPython('darwin', {}, probe), true)
  assert.equal(tried[0], 'python3')
  tried.length = 0
  assert.equal(findPython('win32', { TE_PYTHON: 'x' }, probe), false)
  assert.deepEqual(tried, ['python'])
  tried.length = 0
  findPython('linux', { TE_PYTHON: '/py' }, probe)
  assert.deepEqual(tried, ['/py'])
})

test('a TokenEconomizer enabled in the user Codex config is noticed', () => {
  const home = mkdtempSync(join(tmpdir(), 'brandy-home-'))
  const write = (t: string) => writeFileSync(join(home, 'config.toml'), t)
  assert.equal(userHasEconomizer(home), false)
  write('[plugins."tokeneconomizer@m"]\nenabled = true\n')
  assert.equal(userHasEconomizer(home), true)
  write('[plugins."tokeneconomizer@m"]\nenabled = false\n[plugins."outro@m"]\nenabled = true\n')
  assert.equal(userHasEconomizer(home), false)
  rmSync(home, { recursive: true })
})
