// A connector as the panel sees it: no auth details, and a status that says when a login is missing.
import type { Connector, ConnectorStatus, ConnectorView } from '../../shared/connectors.ts'
import { connectorProblem } from '../../shared/connector-problem.ts'

export function connectorView(
  c: Connector,
  hub: { status(id: string): { status: ConnectorStatus; error?: string; toolCount?: number } },
  login: { needsLoginNow(c: Connector): boolean },
): ConnectorView {
  const { auth, ...rest } = c
  // a definition that cannot run says so instead of "desconectado"; Corrigir or Remover settle it
  const problem = connectorProblem(c)
  if (problem) return { ...rest, authKind: auth.kind, status: 'erro', error: problem, problem }
  const live = hub.status(c.id)
  // before its first connect, a token connector without its stored values shows that it needs one
  const missing = live.status === 'desconectado' && login.needsLoginNow(c)
  return { ...rest, authKind: auth.kind, ...live, ...(missing ? { status: 'precisa de login' as const } : {}) }
}
