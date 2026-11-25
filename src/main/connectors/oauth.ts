// OAuth login for HTTP connectors: a loopback listener catches the redirect, the SDK exchanges the code.
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { Connector } from '../../shared/connectors.ts'
import { finishAuth, realFactory } from './client.ts'
import type { AuthMaterial, ClientFactory } from './hub.ts'
import { makeOAuthProvider } from './oauth-provider.ts'
import type { SecretStore } from './secrets.ts'
import { cancelledMessage } from './cli-login.ts'

const DONE_PAGE = 'Login concluído. Pode voltar ao BrandyTerm.'

/** Login provider: like the stored one, but a client registered for another redirect URL is not reused. */
export function createOAuthProvider(id: string, secrets: SecretStore, redirectUrl: string, onRedirect: (url: URL) => void, state?: string): OAuthClientProvider {
  const base = makeOAuthProvider(id, secrets, redirectUrl, onRedirect)
  return {
    get redirectUrl() { return base.redirectUrl },
    get clientMetadata() { return base.clientMetadata },
    clientInformation: async () => {
      const info = await base.clientInformation()
      const uris = (info as { redirect_uris?: string[] } | undefined)?.redirect_uris
      return info && uris?.includes(redirectUrl) ? info : undefined
    },
    ...(state ? { state: () => state } : {}),
    saveClientInformation: i => base.saveClientInformation!(i),
    tokens: () => base.tokens(),
    saveTokens: t => base.saveTokens(t),
    redirectToAuthorization: u => base.redirectToAuthorization(u),
    saveCodeVerifier: v => base.saveCodeVerifier(v),
    codeVerifier: () => base.codeVerifier(),
    invalidateCredentials: scope => base.invalidateCredentials!(scope),
  }
}

/** Listens on 127.0.0.1:<random>/callback until one code (or error) carrying `state` arrives or `signal` aborts; then closes. */
export async function waitForCode(signal: AbortSignal, state: string): Promise<{ redirectUrl: string; code: Promise<string> }> {
  let settle: { ok(code: string): void; fail(e: Error): void } = { ok() {}, fail() {} }
  const code = new Promise<string>((ok, fail) => { settle = { ok, fail } })
  code.catch(() => {})
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (u.pathname !== '/callback') { res.statusCode = 404; return void res.end() }
    // another local process or page can hit this port: only the callback of this login counts
    if (u.searchParams.get('state') !== state) { res.statusCode = 400; return void res.end() }
    const err = u.searchParams.get('error')
    const got = u.searchParams.get('code')
    if (!err && !got) { res.statusCode = 400; return void res.end() }
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end(err ? `Login não concluído: ${err}` : DONE_PAGE, () => finish())
    if (err) settle.fail(new Error(u.searchParams.get('error_description') || err))
    else settle.ok(got!)
  })
  const finish = () => { signal.removeEventListener('abort', onAbort); server.close(); server.closeAllConnections() }
  const onAbort = () => { settle.fail(new Error('login cancelado')); finish() }
  await new Promise<void>((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res) })
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  return { redirectUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`, code }
}

export interface OAuthRunnerDeps {
  secrets: SecretStore
  /** opens the authorization URL in the user's browser (shell.openExternal) */
  open: (url: string) => void | Promise<void>
  factory?: ClientFactory
}

/** The real `oauth` login runner: connect, follow the redirect once, exchange the code, connect again to prove it. */
export function makeOAuthRunner(d: OAuthRunnerDeps): (c: Connector, signal: AbortSignal) => Promise<void> {
  const factory = d.factory ?? realFactory
  return async (c, signal) => {
    const inner = new AbortController()
    const stop = () => inner.abort()
    signal.addEventListener('abort', stop, { once: true })
    try {
      const state = randomBytes(16).toString('hex')
      const { redirectUrl, code } = await waitForCode(inner.signal, state)
      let redirected = false
      const oauth = createOAuthProvider(c.id, d.secrets, redirectUrl, url => { redirected = true; void d.open(url.href) }, state)
      const auth: AuthMaterial = { env: {}, headers: {}, oauth }
      const probe = async () => { await (await factory(c, auth)).close() }
      try {
        await probe()
      } catch (e) {
        if ((e as { kind?: string }).kind !== 'login' || !redirected) throw e
        await finishAuth(c, auth, await code)
        await probe()
      }
    } catch (e) {
      if (signal.aborted) throw new Error(cancelledMessage(c.name))
      throw e
    } finally {
      signal.removeEventListener('abort', stop)
      inner.abort()
    }
  }
}
