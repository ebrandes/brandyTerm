import type { ConnectorStatus } from '../../../shared/connectors.ts'

export const RAILWAY_HINT = 'Atualize o Railway CLI para a versão 5.44.0 ou mais nova (railway mcp).'

export const statusClass = (s: ConnectorStatus): string =>
  s === 'conectado' ? 'ok' : s === 'erro' ? 'err' : s === 'precisa de login' ? 'warn' : 'off'

/** The `connectors:login` args of the row's Entrar: a token needs the card (to type it), the others run at once. */
export const entrarArgs = (c: { id: string; authKind: string }): { id: string; values?: Record<string, string> } =>
  c.authKind === 'token' ? { id: c.id } : { id: c.id, values: {} }
