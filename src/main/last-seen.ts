import type { Project } from '../shared/types.ts'

/**
 * When the user last had each project open (sidebar "novidades"). Kept in
 * settings.json; no Electron import here so scripts/ can check it with node.
 */

type LastSeen = Record<string, string>
const valid = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v))

/** a patch from the renderer only adds or moves forward valid entries */
export function mergeLastSeen(current: LastSeen | undefined, patch: unknown): LastSeen {
  const out: LastSeen = { ...current }
  if (!patch || typeof patch !== 'object') return out
  for (const [id, at] of Object.entries(patch as Record<string, unknown>)) {
    if (!valid(at)) continue
    if (!out[id] || Date.parse(at) > Date.parse(out[id])) out[id] = at
  }
  return out
}

/**
 * At startup: projects with no entry start as seen now (so the first launch
 * does not flag every old thread) and removed projects are dropped.
 * Returns null when nothing changed.
 */
export function seedLastSeen(current: LastSeen | undefined, projects: Pick<Project, 'id'>[], now: string): LastSeen | null {
  const ids = new Set(projects.map((p) => p.id))
  const out: LastSeen = {}
  let changed = false
  for (const [id, at] of Object.entries(current ?? {})) {
    if (ids.has(id) && valid(at)) out[id] = at
    else changed = true
  }
  for (const id of ids) {
    if (!out[id]) {
      out[id] = now
      changed = true
    }
  }
  return changed ? out : null
}
