import type { ActionResult } from '../shared/api.ts'
import type { Project } from '../shared/types.ts'
import { busyReason } from '../shared/project-busy.ts'
import { deleteArchive } from './archive.ts'
import { resetSession } from './coordinator-memory.ts'
import { dropLastSeen } from './last-seen.ts'

export { busyReason, liveThreads } from '../shared/project-busy.ts'

/**
 * The sidebar's per-project actions, as pure state changes (no Electron, no engine), so
 * scripts/project-actions-check.ts can run them with node. project-actions-ipc.ts validates
 * the caller's input, finds the project and saves. None of these touches the project's folder.
 */

export const NAME_MAX = 80
const ok: ActionResult = { ok: true }
const no = (error: string): ActionResult => ({ ok: false, error })

/** a display name: trimmed, inner whitespace collapsed, at most NAME_MAX characters; null when empty or not text */
export function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim()
  return s || null
}

/** renames only what the app shows; the folder keeps its name */
export function renameProject(p: Project, name: unknown): ActionResult {
  const clean = cleanName(name)
  if (!clean) return no('O nome não pode ficar vazio.')
  p.name = clean
  return ok
}

export function setProjectArchived(p: Project, archived: boolean, now = new Date()): ActionResult {
  if (archived) p.archivedAt ??= now.toISOString()
  else p.archivedAt = undefined
  return ok
}

/**
 * New coordinator session on the next message (the same switch the automatic rotation does).
 * Keeps .brandyterm/memoria.md, the threads and the visible chat; a note marks where it happened.
 */
export function clearCoordinatorContext(p: Project, note: Project['messages'][number]): ActionResult {
  const why = busyReason(p)
  if (why) return no(why)
  resetSession(p)
  p.messages.push(note)
  return ok
}

/** may the project leave the app now? (removal itself is the engine's, which also cancels runs) */
export function canRemove(p: Project): ActionResult {
  const why = busyReason(p)
  return why ? no(why) : ok
}

/**
 * What a removed project leaves in the app's own data: its archive file and its lastSeen entry.
 * Returns the lastSeen to save. Never looks at the project's folder.
 */
export function forgetProjectData(archiveDir: string, lastSeen: Record<string, string> | undefined, projectId: string): Record<string, string> {
  deleteArchive(archiveDir, projectId)
  return dropLastSeen(lastSeen, projectId)
}
