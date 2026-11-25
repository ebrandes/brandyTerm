// What a remote device may see of the app state, and which project a call touches. Pure.
import type { AppState } from '../../shared/types.ts'

export function filterState(s: AppState): AppState {
  const { accounts, settings, ...rest } = s
  const out: AppState = { ...rest, projects: s.projects.filter(p => !p.remoteHidden) }
  if (accounts) {
    out.accounts = {
      list: accounts.list.map(a => ({
        id: a.id, label: a.label, kind: a.kind, plan: a.plan,
        fiveHour: a.fiveHour, sevenDay: a.sevenDay, limitedUntil: a.limitedUntil
      })),
      activeId: accounts.activeId,
      autoSwitch: accounts.autoSwitch
    }
  }
  if (settings) {
    const { lastSeen: _l, lastProjectId: _p, remote: _r, ...keep } = settings
    out.settings = keep
  }
  return out
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Project a call refers to, or null (no project, or several: the server filters those itself). */
export function projectOf(channel: string, arg: unknown): string | null {
  if (channel === 'commands:list' || channel === 'project:remove') return typeof arg === 'string' ? arg : null
  if (channel.startsWith('term:')) {
    if (typeof arg === 'string') return arg
    return isObj(arg) && typeof arg.id === 'string' ? arg.id : null
  }
  return isObj(arg) && typeof arg.projectId === 'string' ? arg.projectId : null
}
