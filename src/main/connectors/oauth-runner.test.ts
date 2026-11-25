import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { makeOAuthRunner } from './oauth.ts'
import { ConnectorError, type ClientFactory, type LiveClient } from './hub.ts'
import { SecretStore } from './secrets.ts'
import type { Connector } from '../../shared/connectors.ts'

const cipher = { available: () => true, encrypt: (s: string) => 'x' + s, decrypt: (s: string) => s.slice(1) }
const store = () => new SecretStore(join(fs.mkdtempSync(join(os.tmpdir(), 'or-')), 's.json'), cipher)
const live: LiveClient = { tools: async () => [], call: async () => ({ content: [] }), close: async () => {}, onClose: () => {} }

async function tokenServer() {
  const srv = createServer((req, res) => {
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`
    res.setHeader('content-type', 'application/json')
    if (req.url?.startsWith('/.well-known/oauth-authorization-server')) {
      res.end(JSON.stringify({ issuer: base, authorization_endpoint: `${base}/auth`, token_endpoint: `${base}/token`, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] }))
    } else if (req.url === '/token') { req.resume(); res.end(JSON.stringify({ access_token: 'tok', token_type: 'bearer' })) }
    else { res.statusCode = 404; res.end('{}') }
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  return { srv, base: `http://127.0.0.1:${(srv.address() as { port: number }).port}` }
}
const conn = (url: string): Connector => ({ id: 'c1', name: 'Linear', description: '', transport: 'http', url, auth: { kind: 'oauth' }, enabled: true, alwaysAllow: [] })

test('redirect, loopback code, token exchange, then a second connect proves the login', async () => {
  const { srv, base } = await tokenServer()
  try {
    const secrets = store()
    secrets.patch('c1', { oauth: { client: { client_id: 'cid', redirect_uris: ['http://old/cb'] }, verifier: 'v' } })
    let connects = 0
    const opened: string[] = []
    const factory: ClientFactory = async (_c, auth) => {
      if (connects++ === 0) {
        const p = auth.oauth!
        assert.equal(await p.clientInformation(), undefined, 'stale registration is not reused')
        p.saveClientInformation!({ client_id: 'cid', redirect_uris: [String(p.redirectUrl)] } as never)
        p.saveCodeVerifier('v')
        await p.redirectToAuthorization(new URL(`${base}/auth?redirect_uri=${encodeURIComponent(String(p.redirectUrl))}`))
        throw new ConnectorError('Precisa de login.', 'login')
      }
      return live
    }
    const run = makeOAuthRunner({
      secrets, factory,
      open: url => { opened.push(url); const r = new URL(url).searchParams.get('redirect_uri')!; void fetch(`${r}?code=the-code`) },
    })
    await run(conn(`${base}/mcp`), new AbortController().signal)
    assert.equal(connects, 2)
    assert.equal(opened.length, 1)
    assert.equal((secrets.get('c1').oauth!.tokens as { access_token: string }).access_token, 'tok')
  } finally { srv.close() }
})

test('already authorised: no browser, one connect', async () => {
  let opened = 0
  const run = makeOAuthRunner({ secrets: store(), factory: async () => live, open: () => { opened++ } })
  await run(conn('http://127.0.0.1:1/mcp'), new AbortController().signal)
  assert.equal(opened, 0)
})

test('a failure that is not a login request propagates', async () => {
  const run = makeOAuthRunner({ secrets: store(), factory: async () => { throw new ConnectorError('fora do ar', 'failed') }, open: () => {} })
  await assert.rejects(run(conn('http://127.0.0.1:1/mcp'), new AbortController().signal), /fora do ar/)
})

test('Cancelar while the browser step is open rejects with the cancelado text and closes the listener', async () => {
  let redirect = ''
  const factory: ClientFactory = async (_c, auth) => {
    redirect = String(auth.oauth!.redirectUrl)
    await auth.oauth!.redirectToAuthorization(new URL('https://x/auth'))
    throw new ConnectorError('Precisa de login.', 'login')
  }
  const ac = new AbortController()
  const run = makeOAuthRunner({ secrets: store(), factory, open: () => { setImmediate(() => ac.abort()) } })
  await assert.rejects(run(conn('http://127.0.0.1:1/mcp'), ac.signal), /login do Linear cancelado/)
  await assert.rejects(fetch(redirect))
})
