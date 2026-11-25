// Project ids of paired machines are namespaced in the renderer: `@machineId/projectId`. Pure.
import { SCOPED, projectOf, withProjectId } from '../../../shared/remote/scope.ts'

export function remoteId(machineId: string, projectId: string): string {
  return `@${machineId}/${projectId}`
}

export function parseId(id: string): { machineId: string | null; projectId: string } {
  if (id.startsWith('@')) {
    const i = id.indexOf('/')
    if (i > 1) return { machineId: id.slice(1, i), projectId: id.slice(i + 1) }
  }
  return { machineId: null, projectId: id }
}

/** Where a call goes: a remote id (found where the host reads it) sends it to that machine with the id restored. */
export function routeCall(channel: string, arg: unknown): { machineId: string | null; arg: unknown } {
  const id = SCOPED[channel] ? projectOf(channel, arg) : null
  if (id === null) return { machineId: null, arg }
  const { machineId, projectId } = parseId(id)
  return machineId === null ? { machineId: null, arg } : { machineId, arg: withProjectId(channel, arg, projectId) }
}

/** Splits project ids by owner (null = this machine). Non-strings stay local, where the handler checks them. */
export function splitIds(ids: unknown): Map<string | null, unknown[]> {
  const out = new Map<string | null, unknown[]>()
  for (const id of Array.isArray(ids) ? ids : []) {
    const r = typeof id === 'string' ? parseId(id) : { machineId: null, projectId: id }
    out.set(r.machineId, [...(out.get(r.machineId) ?? []), r.projectId])
  }
  return out
}
