import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { createOAuthProvider, waitForCode } from './oauth.ts'
import { SecretStore } from './secrets.ts'

const cipher = { available: () => true, encrypt: (s: string) => 'x' + s, decrypt: (s: string) => s.slice(1) }
const store = () => new SecretStore(join(fs.mkdtempSync(join(os.tmpdir(), 'oa-')), 's.json'), cipher)

test('provider round-trip through the secret store', async () => {
  const secrets = store()
  const p = createOAuthProvider('c1', secrets, 'http://127.0.0.1:1/callback', () => {})
  p.saveTokens({ access_token: 'a', token_type: 'bearer' })
  assert.equal(((await p.tokens()) as { access_token: string }).access_token, 'a')
})

test('a stored client registration for another redirect URL is not reused', async () => {
  const secrets = store()
  const old = createOAuthProvider('c1', secrets, 'http://127.0.0.1:1/callback', () => {})
  old.saveClientInformation!({ client_id: 'cid', redirect_uris: ['http://127.0.0.1:1/callback'] } as never)
  assert.equal(((await old.clientInformation()) as { client_id: string }).client_id, 'cid')
  const next = createOAuthProvider('c1', secrets, 'http://127.0.0.1:2/callback', () => {})
  assert.equal(await next.clientInformation(), undefined)
})

test('redirect goes to the injected handler', async () => {
  let seen = ''
  const p = createOAuthProvider('c1', store(), 'http://127.0.0.1:1/callback', u => { seen = u.href })
  await p.redirectToAuthorization(new URL('https://x/auth'))
  assert.equal(seen, 'https://x/auth')
})

test('waitForCode resolves the code from the callback, answers in Portuguese and closes the server', async () => {
  const ac = new AbortController()
  const { redirectUrl, code } = await waitForCode(ac.signal)
  assert.match(redirectUrl, /^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  const res = await fetch(`${redirectUrl}?code=xyz&state=s`)
  assert.equal(await res.text(), 'Login concluído. Pode voltar ao BrandyTerm.')
  assert.equal(await code, 'xyz')
  await assert.rejects(fetch(redirectUrl))
})

test('waitForCode ignores other paths and rejects on an error callback', async () => {
  const { redirectUrl, code } = await waitForCode(new AbortController().signal)
  assert.equal((await fetch(redirectUrl.replace('/callback', '/favicon.ico'))).status, 404)
  const rejected = assert.rejects(code, /access_denied/)
  await fetch(`${redirectUrl}?error=access_denied`)
  await rejected
})

test('aborting closes the server and rejects the code', async () => {
  const ac = new AbortController()
  const { redirectUrl, code } = await waitForCode(ac.signal)
  const rejected = assert.rejects(code, /cancelado/)
  ac.abort()
  await rejected
  await assert.rejects(fetch(redirectUrl))
})
