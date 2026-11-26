// The color of a connector's dot in the sidebar, for the project in view. Pure; the panel's only rule for it.
// Same availability rule as main (store.ts visibleFor): switched on and either not limited or limited to this project.
import type { ConnectorStatus } from './connectors.ts'

export type ConnectorTone = 'on' | 'idle' | 'off'

export interface ConnectorDot {
  /** on = green (usable here), idle = yellow (connected, not on in this project), off = gray (not connected or failing) */
  tone: ConnectorTone
  /** tooltip and aria-label, pt-BR */
  label: string
}

interface Input {
  name: string
  status: ConnectorStatus
  enabled: boolean
  /** project paths it is limited to; none or empty: every project */
  projects?: string[]
  error?: string
}

export interface DotProject {
  name: string
  path: string | null
  /** the project runs on another machine, so this machine's connectors are never used there */
  elsewhere?: string
}

const NOT_CONNECTED: Record<Exclude<ConnectorStatus, 'conectado'>, string> = {
  desconectado: 'desconectado',
  'precisa de login': 'precisa de login',
  erro: 'com erro'
}

/** Why a connected connector is not used in `project`, or null when it is. */
function offHere(c: Input, project: DotProject | undefined): string | null {
  if (!c.enabled) return 'desligado'
  if (!project) return c.projects?.length ? 'limitado a outros projetos' : null
  if (project.elsewhere) return `não usado em ${project.name}: roda em ${project.elsewhere}`
  const limits = c.projects ?? []
  if (limits.length === 0) return null
  return project.path && limits.includes(project.path) ? null : `não habilitado em ${project.name}`
}

export function connectorDot(c: Input, project?: DotProject): ConnectorDot {
  if (c.status !== 'conectado') {
    const why = NOT_CONNECTED[c.status] ?? 'desconectado'
    const detail = c.status === 'erro' && c.error ? `: ${c.error}` : ''
    return { tone: 'off', label: `${c.name}: ${why}${detail}` }
  }
  const off = offHere(c, project)
  if (off) return { tone: 'idle', label: `${c.name}: conectado, mas ${off}` }
  return { tone: 'on', label: project ? `${c.name}: conectado e habilitado em ${project.name}` : `${c.name}: conectado` }
}
