// Which channels carry a project id, and where. Shared by the host (authorization) and the renderer (routing). Pure.

export type Where = 'arg' | 'id' | 'arg-or-id' | 'projectId'

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Where a project-scoped channel carries its project id. */
export const SCOPED: Record<string, Where> = {
  'commands:list': 'arg', 'project:remove': 'arg', 'process:detected': 'arg', 'process:stop-detected': 'projectId',
  'term:open': 'id', 'term:write': 'id', 'term:resize': 'id', 'term:kill': 'arg-or-id',
  'chat:send': 'projectId', 'fs:list': 'projectId', 'thread:cancel': 'projectId', 'thread:approve': 'projectId',
  'thread:resolve': 'projectId', 'thread:report': 'projectId', 'thread:allowAll': 'projectId', 'archive:reopen': 'projectId',
  'thread:retire': 'projectId',
  'artifact:read': 'projectId', 'artifact:diff': 'projectId', 'artifact:open': 'projectId', 'process:start': 'projectId',
  'process:stop': 'projectId', 'process:remove': 'projectId', 'attach:save': 'projectId',
  'attach:read': 'projectId', 'artifact:bytes': 'projectId',
  'project:rename': 'projectId', 'project:archive': 'projectId', 'project:clear-context': 'projectId',
  'project:reveal': 'projectId',
  'skills:toggle': 'projectId', 'skills:installMissing': 'projectId'
}

/** Channels known to name no project (archive:list names several, in an array). Anything not here or in SCOPED is refused by the host. */
export const UNSCOPED = new Set([
  'state:get', 'archive:list', 'settings:set', 'project:set-remote-hidden', 'plugin:install', 'plugin:open-report', 'logs:open', 'usage:report',
  'logs:read', 'logs:summarize', 'logs:summarize-cancel',
  'project:open-folder', 'attach:open', 'process:open-port', 'clipboard:read', 'clipboard:write',
  'accounts:activate', 'accounts:auto', 'accounts:rename', 'accounts:remove', 'accounts:probe',
  'accounts:add-token', 'accounts:login-start', 'accounts:login-cancel',
  'remote:hosts', 'remote:states', 'remote:call', 'remote:open-pairing', 'remote:close-pairing', 'remote:devices',
  'remote:revoke', 'remote:set-terminal', 'remote:discovered', 'remote:pair', 'remote:rename', 'remote:open-bytes',
  'remote:discover',
  'remote:status',
  'fs:browse', 'project:add-path',
  'skills:setLibrary',
  'notify:view', 'notify:take-target'
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

/** The same arg with the project id (at the position projectOf reads) replaced. */
export function withProjectId(channel: string, arg: unknown, id: string): unknown {
  const where = SCOPED[channel]
  if (where === 'arg' || (where === 'arg-or-id' && typeof arg === 'string')) return id
  if (!isObj(arg)) return arg
  return { ...arg, [where === 'projectId' ? 'projectId' : 'id']: id }
}
