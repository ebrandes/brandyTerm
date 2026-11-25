// What a remote device may see of the app state, and which calls it may make about which projects. Pure.
import type { AppState } from '../../shared/types.ts'

export const HIDDEN = 'Projeto não disponível remotamente'

// Settings a remote device may see (allowlist: anything new stays local until listed here).
const SETTINGS_SHOWN = ['keepAwake', 'allowAllThreads', 'idleCompact'] as const

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
    const shown: Record<string, unknown> = {}
    for (const k of SETTINGS_SHOWN) if (k in settings) shown[k] = settings[k]
    out.settings = shown
  }
  return out
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Where a project-scoped channel carries its project id. */
const SCOPED: Record<string, 'arg' | 'id' | 'arg-or-id' | 'projectId'> = {
  'commands:list': 'arg', 'project:remove': 'arg',
  'term:open': 'id', 'term:write': 'id', 'term:resize': 'id', 'term:kill': 'arg-or-id',
  'chat:send': 'projectId', 'fs:list': 'projectId', 'thread:cancel': 'projectId', 'thread:approve': 'projectId',
  'thread:resolve': 'projectId', 'thread:allowAll': 'projectId', 'archive:reopen': 'projectId',
  'artifact:read': 'projectId', 'artifact:open': 'projectId', 'process:start': 'projectId',
  'process:stop': 'projectId', 'process:remove': 'projectId', 'attach:save': 'projectId'
}

/** Channels known to name no project. Anything not here or in SCOPED is refused. */
const UNSCOPED = new Set([
  'state:get', 'archive:list', 'userPlugins:set', 'settings:set', 'plugin:install', 'plugin:open-report',
  'project:open-folder', 'attach:open', 'process:open-port', 'clipboard:read', 'clipboard:write',
  'accounts:activate', 'accounts:auto', 'accounts:rename', 'accounts:remove', 'accounts:probe',
  'accounts:add-token', 'accounts:login-start', 'accounts:login-cancel'
])

/** The project id a scoped call refers to; null when the channel is unscoped or the id is not a string. */
export function projectOf(channel: string, arg: unknown): string | null {
  const where = SCOPED[channel]
  if (!where) return null
  const pick = (v: unknown): string | null => (typeof v === 'string' ? v : null)
  if (where === 'arg') return pick(arg)
  if (where === 'arg-or-id') return typeof arg === 'string' ? arg : isObj(arg) ? pick(arg.id) : null
  if (!isObj(arg)) return null
  return pick(where === 'id' ? arg.id : arg.projectId)
}

export type Authorized = { ok: true; arg: unknown } | { ok: false; error: string }

/** Decides whether a remote call may proceed, and with which argument (archive:list is filtered). */
export function authorize(channel: string, arg: unknown, state: AppState): Authorized {
  const visible = (id: string): boolean => state.projects.some(p => p.id === id && !p.remoteHidden)
  if (channel === 'archive:list') {
    return { ok: true, arg: Array.isArray(arg) ? arg.filter((id): id is string => typeof id === 'string' && visible(id)) : [] }
  }
  if (channel in SCOPED) {
    const id = projectOf(channel, arg)
    return id !== null && visible(id) ? { ok: true, arg } : { ok: false, error: HIDDEN }
  }
  return UNSCOPED.has(channel) ? { ok: true, arg } : { ok: false, error: HIDDEN }
}
