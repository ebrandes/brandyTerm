import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loginPath, mergePath, resetShellPathCache } from './shell-path.ts'

test('mergePath joins, dedupes and keeps order', () => {
  assert.equal(mergePath(['/a', '/b'], ['/b', '/c'], ['/d']), '/a:/b:/c:/d')
})

test('loginPath merges the login shell PATH once with process PATH and fallbacks', async () => {
  resetShellPathCache()
  let runs = 0
  const run = async () => { runs++; return '/opt/x/bin:/usr/bin' }
  const a = await loginPath({ run, platform: 'darwin', envPath: '/usr/bin:/bin', home: '/h' })
  const b = await loginPath({ run, platform: 'darwin', envPath: '/usr/bin:/bin', home: '/h' })
  assert.equal(runs, 1)
  assert.equal(a, b)
  assert.equal(a, '/usr/bin:/bin:/opt/x/bin:/opt/homebrew/bin:/usr/local/bin:/h/.local/bin')
})

test('loginPath falls back when the shell fails', async () => {
  resetShellPathCache()
  const p = await loginPath({ run: async () => { throw new Error('timeout') }, platform: 'darwin', envPath: '/usr/bin', home: '/h' })
  assert.equal(p, '/usr/bin:/opt/homebrew/bin:/usr/local/bin:/h/.local/bin')
})

test('loginPath leaves PATH alone on Windows', async () => {
  resetShellPathCache()
  const p = await loginPath({ run: async () => { throw new Error('no') }, platform: 'win32', envPath: 'C:\\x' })
  assert.equal(p, 'C:\\x')
})
