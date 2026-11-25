import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { makeOAuthProvider } from './oauth-provider.ts'
import { ConnectorError } from './hub.ts'
import { SecretStore } from './secrets.ts'

const cipher = { available: () => true, encrypt: (s: string) => 'x' + s, decrypt: (s: string) => s.slice(1) }

test('outside a login flow redirectToAuthorization throws needs-login and opens nothing', async () => {
  const secrets = new SecretStore(join(fs.mkdtempSync(join(os.tmpdir(), 'oa-')), 's.json'), cipher)
  const p = makeOAuthProvider('c1', secrets, 'http://127.0.0.1:1/cb')
  await assert.rejects(Promise.resolve().then(() => p.redirectToAuthorization(new URL('https://x/auth'))), (e: unknown) => e instanceof ConnectorError && e.kind === 'login')
})

test('tokens, client and verifier persist through the secret store', async () => {
  const secrets = new SecretStore(join(fs.mkdtempSync(join(os.tmpdir(), 'oa-')), 's.json'), cipher)
  const p = makeOAuthProvider('c1', secrets, 'http://127.0.0.1:1/cb')
  assert.equal(await p.tokens(), undefined)
  p.saveTokens({ access_token: 'a', token_type: 'bearer' })
  p.saveClientInformation!({ client_id: 'cid' })
  p.saveCodeVerifier('v')
  const again = makeOAuthProvider('c1', secrets, 'http://127.0.0.1:1/cb')
  assert.equal(((await again.tokens()) as { access_token: string }).access_token, 'a')
  assert.equal(((await again.clientInformation()) as { client_id: string }).client_id, 'cid')
  assert.equal(again.codeVerifier(), 'v')
})

test('a login flow can supply its own redirect handler', async () => {
  const secrets = new SecretStore(join(fs.mkdtempSync(join(os.tmpdir(), 'oa-')), 's.json'), cipher)
  let seen = ''
  const p = makeOAuthProvider('c1', secrets, 'http://127.0.0.1:1/cb', u => { seen = u.href })
  await p.redirectToAuthorization(new URL('https://x/auth'))
  assert.equal(seen, 'https://x/auth')
})

test('finishAuth exchanges the code and stores the tokens', async () => {
  const { createServer } = await import('node:http')
  const { finishAuth } = await import('./client.ts')
  const srv = createServer((req, res) => {
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`
    res.setHeader('content-type', 'application/json')
    if (req.url?.startsWith('/.well-known/oauth-authorization-server')) {
      res.end(JSON.stringify({ issuer: base, authorization_endpoint: `${base}/auth`, token_endpoint: `${base}/token`, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] }))
    } else if (req.url === '/token') {
      req.resume()
      res.end(JSON.stringify({ access_token: 'tok', token_type: 'bearer' }))
    } else { res.statusCode = 404; res.end('{}') }
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  try {
    const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/mcp`
    const secrets = new SecretStore(join(fs.mkdtempSync(join(os.tmpdir(), 'oa-')), 's.json'), cipher)
    const p = makeOAuthProvider('c1', secrets, 'http://127.0.0.1:1/cb')
    p.saveClientInformation!({ client_id: 'cid' })
    p.saveCodeVerifier('verifier')
    const c = { id: 'c1', name: 'C', description: '', transport: 'http' as const, url, auth: { kind: 'oauth' as const }, enabled: true, alwaysAllow: [] }
    await finishAuth(c, { env: {}, headers: {}, oauth: p }, 'the-code')
    assert.equal(secrets.get('c1').oauth && (secrets.get('c1').oauth!.tokens as { access_token: string }).access_token, 'tok')
  } finally { srv.close() }
})
