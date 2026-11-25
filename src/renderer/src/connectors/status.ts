import type { ConnectorStatus } from '../../../shared/connectors.ts'

export const RAILWAY_HINT = 'Atualize o Railway CLI para a versão 5.44.0 ou mais nova (railway mcp).'

export const statusClass = (s: ConnectorStatus): string =>
  s === 'conectado' ? 'ok' : s === 'erro' ? 'err' : s === 'precisa de login' ? 'warn' : 'off'
