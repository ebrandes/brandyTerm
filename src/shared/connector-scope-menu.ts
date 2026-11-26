// The scope choices of a connector's menu, for the project in view.
import type { DotProject } from './connector-dot.ts'
import { activeIn, isGlobal, scopePatch, type ConnectorScope } from './connector-scope.ts'

export interface ScopeChoice {
  id: 'everywhere' | 'here'
  /** whether choosing it turns the connector on */
  on: boolean
  label: string
  patch: Required<ConnectorScope>
}

export function scopeChoices(c: ConnectorScope, here: DotProject | undefined): ScopeChoice[] {
  const out: ScopeChoice[] = []
  if (!isGlobal(c)) out.push({ id: 'everywhere', on: true, label: 'Ativar em todos os projetos', patch: scopePatch(c, { global: true })! })
  // this machine's connectors are never used on another one
  if (!here?.path || here.elsewhere) return out
  const on = !activeIn(c, here.path)
  const patch = scopePatch(c, { path: here.path, on })
  if (patch) out.push({ id: 'here', on, label: `${on ? 'Ativar' : 'Desativar'} em ${here.name}`, patch })
  return out
}
