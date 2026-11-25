// Pure helpers for the machine UI (sidebar groups, offline label, pairing countdown). No DOM/Electron.
import type { Project } from '../../shared/types.ts'
import type { MachineInfo, RemoteHostInfo, TrustRole } from '../../shared/remote/machine.ts'

export const PAIRING_SECONDS = 120

export interface MachineGroup {
  id: string
  name: string
  local: boolean
  online: boolean
  since?: string
  projects: Project[]
}

const hhmm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** "offline desde 14:05"; without a time, just "offline" */
export function offlineLabel(since?: string): string {
  const d = since ? new Date(since) : null
  return d && !Number.isNaN(d.getTime()) ? `offline desde ${hhmm(d)}` : 'offline'
}

/** Group header: this machine reads "<name> (este)". */
export function groupTitle(g: Pick<MachineGroup, 'name' | 'local'>): string {
  return g.local ? `${g.name} (este)` : g.name
}

/**
 * Projects grouped by owning machine: this machine first, then each paired host in order.
 * A paired host without projects still gets a group (so its "Abrir pasta" stays reachable).
 */
export function groupProjects(projects: Project[], hosts: RemoteHostInfo[], me?: MachineInfo): MachineGroup[] {
  const groups: MachineGroup[] = [{ id: me?.id ?? 'local', name: me?.name ?? 'Este computador', local: true, online: true, projects: [] }]
  const byId = new Map<string, MachineGroup>([[groups[0].id, groups[0]]])
  for (const h of hosts) {
    const g: MachineGroup = { id: h.machine.id, name: h.machine.name, local: false, online: h.online, since: h.since, projects: [] }
    groups.push(g)
    byId.set(g.id, g)
  }
  for (const p of projects) {
    const m = p.machine
    let g = m ? byId.get(m.id) : groups[0]
    if (!g && m) {
      g = { id: m.id, name: m.name, local: !m.remote, online: m.online, since: m.since, projects: [] }
      groups.push(g)
      byId.set(g.id, g)
    }
    ;(g ?? groups[0]).projects.push(p)
  }
  return groups
}

/** Headers only make sense once another machine is in the list. */
export const showGroups = (groups: MachineGroup[]): boolean => groups.length > 1

/** The overview's "Disponível remotamente": once remote access is on or another machine is listed (as the chip). */
export const showRemoteToggle = (remoteEnabled: boolean, groups: MachineGroup[]): boolean => remoteEnabled || showGroups(groups)

/** The chat's terminal button: a terminal here, "em breve" on a paired machine's project, none without a folder. */
export function terminalAccess(p: Pick<Project, 'demo' | 'path' | 'machine'>): 'local' | 'remote' | null {
  if (p.demo || !p.path) return null
  return p.machine?.remote ? 'remote' : 'local'
}

/** Whole seconds left of a pairing code that expires at `expiresAt` (ms). Never negative. */
export const secondsLeft = (expiresAt: number, now: number): number => Math.max(0, Math.ceil((expiresAt - now) / 1000))

/** 120 -> "2:00" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "hoje 14:05", "03/11 14:05" or "nunca conectou" */
export function lastSeenLabel(iso: string | undefined, now: Date = new Date()): string {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return 'nunca conectou'
  if (d.toDateString() === now.toDateString()) return `hoje ${hhmm(d)}`
  const day = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  return `${day} ${hhmm(d)}`
}

/** Trust is directional: client controls this machine, host is controlled by it. */
export const roleLabel = (role: TrustRole): string => (role === 'client' ? 'Controla esta máquina' : 'Esta máquina controla')
