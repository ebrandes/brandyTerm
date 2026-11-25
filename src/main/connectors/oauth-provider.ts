// OAuth provider for HTTP connectors; tokens, dynamic client and PKCE verifier live in the SecretStore.
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { ConnectorError, LOGIN_NEEDED } from './hub.ts'
import type { SecretStore } from './secrets.ts'

/** `onRedirect` is only given inside a login flow; without it the provider never opens a browser. */
export function makeOAuthProvider(
  id: string,
  secrets: Pick<SecretStore, 'get' | 'patch'>,
  redirectUrl: string,
  onRedirect?: (url: URL) => void | Promise<void>,
): OAuthClientProvider {
  const oauth = () => secrets.get(id).oauth ?? {}
  const save = (part: Record<string, unknown>) => secrets.patch(id, { oauth: { ...oauth(), ...part } })
  return {
    get redirectUrl() { return redirectUrl },
    get clientMetadata() {
      return {
        client_name: 'BrandyTerm',
        redirect_uris: [redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }
    },
    clientInformation: () => oauth().client as OAuthClientInformationMixed | undefined,
    saveClientInformation: info => save({ client: info }),
    tokens: () => oauth().tokens as OAuthTokens | undefined,
    saveTokens: t => save({ tokens: t }),
    saveCodeVerifier: v => save({ verifier: v }),
    codeVerifier: () => oauth().verifier ?? '',
    redirectToAuthorization: url => {
      if (!onRedirect) throw new ConnectorError(LOGIN_NEEDED, 'login')
      return onRedirect(url)
    },
    // the server said these no longer hold: a refresh that failed drops the tokens, so the next call asks for a login
    invalidateCredentials: scope => {
      const all = scope === 'all'
      const drop = { tokens: all || scope === 'tokens', client: all || scope === 'client', verifier: all || scope === 'verifier' }
      if (!drop.tokens && !drop.client && !drop.verifier) return // 'discovery': nothing of it is stored
      const { tokens, client, verifier } = oauth()
      secrets.patch(id, {
        oauth: { ...(drop.tokens ? {} : tokens !== undefined && { tokens }), ...(drop.client ? {} : client !== undefined && { client }), ...(drop.verifier ? {} : verifier !== undefined && { verifier }) },
      })
    },
  }
}
