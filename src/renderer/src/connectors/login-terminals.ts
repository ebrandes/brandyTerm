// Which login terminals to forget: the ones whose login left the list. Pure.
import type { PanelLogin } from '../../../shared/connectors.ts'

export const loginTerminalOf = (l: Pick<PanelLogin, 'connectorId' | 'terminalId'>): string => l.terminalId ?? `connector-login-${l.connectorId}`

/** `known` are the terminal ids seen so far; returns those no longer in `logins`, and the ids still live. */
export function goneTerminals(known: string[], logins: PanelLogin[]): { gone: string[]; live: string[] } {
  const live = logins.filter((l) => l.authKind === 'cli').map(loginTerminalOf)
  return { gone: known.filter((id) => !live.includes(id)), live }
}
