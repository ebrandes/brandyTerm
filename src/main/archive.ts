import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ArchivedThreadInfo, Project, Thread, Usage } from '../shared/types.ts'

/**
 * Thread retention. Finished threads (resolved, failed, interrupted or cancelled) older
 * than KEEP_DAYS, or beyond the KEEP_RECENT most recent threads of their project, move
 * to one archive file per project (`<userData>/archive/<projectId>.json`). Nothing is
 * deleted: the archive is listed and reopened on demand. Archived threads leave the
 * main state, so they are no longer saved with it, sent over IPC or shown to the
 * coordinator (the project memory already keeps what mattered).
 */
export const KEEP_DAYS = 7
export const KEEP_RECENT = 50
const DAY = 24 * 60 * 60 * 1000

interface ArchiveFile {
  version: 1
  projectId: string
  projectName: string
  threads: Thread[]
}

const ALIVE = new Set<Thread['state']>(['queued', 'running', 'waiting'])

/** archive folder that sits next to the state file */
export function archiveDirFor(stateFile: string): string {
  return join(dirname(stateFile), 'archive')
}

/** finished for good: never running, queued, waiting, nor done with something still pending for the user */
export function archivable(t: Thread): boolean {
  if (ALIVE.has(t.state) || t.approval) return false
  return t.state !== 'done' || !t.pending
}

function activity(t: Thread): number {
  const u = Date.parse(t.updatedAt) || 0
  return t.restoredAt ? Math.max(u, Date.parse(t.restoredAt) || 0) : u
}

/** Which threads of a project go to the archive now. Pure: decides only, moves nothing. */
export function selectToArchive(p: Project, now = Date.now()): Thread[] {
  if (p.demo) return []
  // a request with a thread still in flight keeps all its threads: the synthesis needs them
  const live = new Set(p.threads.filter((t) => ALIVE.has(t.state)).map((t) => t.requestId))
  const ranked = [...p.threads].sort((a, b) => activity(b) - activity(a))
  return ranked.filter(
    (t, i) => archivable(t) && !live.has(t.requestId) && (i >= KEEP_RECENT || now - activity(t) > KEEP_DAYS * DAY)
  )
}

function fileOf(dir: string, projectId: string): string {
  // project ids are UUIDs; anything else is reduced to a safe file name
  return join(dir, `${projectId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`)
}

export function readArchive(dir: string, projectId: string): Thread[] {
  const f = fileOf(dir, projectId)
  try {
    if (!existsSync(f)) return []
    const data = JSON.parse(readFileSync(f, 'utf8')) as ArchiveFile
    return data.version === 1 && Array.isArray(data.threads) ? data.threads : []
  } catch {
    return []
  }
}

/** Deletes a removed project's archive file (only that file, inside the archive folder). True when one was deleted. */
export function deleteArchive(dir: string, projectId: string): boolean {
  const f = fileOf(dir, projectId)
  if (!existsSync(f)) return false
  rmSync(f, { force: true })
  return true
}

/** atomic: a crash leaves either the old file or the new one, never half of it */
function writeArchive(dir: string, p: Project, threads: Thread[]): void {
  mkdirSync(dir, { recursive: true })
  const f = fileOf(dir, p.id)
  const tmp = `${f}.${process.pid}.tmp`
  const data: ArchiveFile = { version: 1, projectId: p.id, projectName: p.name, threads }
  writeFileSync(tmp, JSON.stringify(data), 'utf8')
  renameSync(tmp, f)
}

/** archived threads not also present in the state (a reopened thread lives in the state and wins) */
function visibleArchive(dir: string, p: Project): Thread[] {
  const inState = new Set(p.threads.map((t) => t.id))
  return readArchive(dir, p.id).filter((t) => !inState.has(t.id))
}

function sumUsage(threads: Thread[]): Usage {
  const u: Usage = { input: 0, output: 0, cached: 0, measured: false }
  for (const t of threads) {
    u.input += t.usage.input
    u.output += t.usage.output
    u.cached += t.usage.cached
    if (t.usage.costUsd) u.costUsd = (u.costUsd ?? 0) + t.usage.costUsd
    u.measured ||= t.usage.measured
  }
  return u
}

/** count and tokens of the archive, so the board link and the project total stay right */
export function refreshArchiveInfo(dir: string, p: Project): void {
  const list = visibleArchive(dir, p)
  p.archived = list.length ? { count: list.length, usage: sumUsage(list) } : undefined
}

/**
 * Startup migration. Writes the archive first and only then drops the threads from the
 * state: a crash in between leaves a thread in both places, which the next run merges
 * by id (the state copy wins). Running it twice changes nothing.
 * Returns how many threads moved.
 */
export function archiveProjects(projects: Project[], dir: string, now = Date.now()): number {
  let moved = 0
  for (const p of projects) {
    const out = selectToArchive(p, now)
    if (out.length) {
      const ids = new Set(out.map((t) => t.id))
      const kept = readArchive(dir, p.id).filter((t) => !ids.has(t.id))
      writeArchive(dir, p, [...kept, ...out])
      p.threads = p.threads.filter((t) => !ids.has(t.id))
      moved += out.length
    }
    refreshArchiveInfo(dir, p)
  }
  return moved
}

/** archived threads of these projects, newest first, without their messages */
export function listArchived(dir: string, projects: Project[]): ArchivedThreadInfo[] {
  return projects
    .flatMap((p) =>
      visibleArchive(dir, p).map((t) => ({
        projectId: p.id,
        projectName: p.name,
        id: t.id,
        title: t.title,
        agent: t.agent,
        state: t.state,
        summary: t.summary,
        note: t.note,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt
      }))
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * Brings an archived thread back into the state. The archive keeps its copy (nothing is
 * deleted; the state copy hides it) until the thread is archived again and overwrites it.
 */
export function reopenArchived(dir: string, p: Project, threadId: string, now = new Date()): Thread | undefined {
  if (p.threads.some((t) => t.id === threadId)) return p.threads.find((t) => t.id === threadId)
  const t = readArchive(dir, p.id).find((x) => x.id === threadId)
  if (!t) return undefined
  t.restoredAt = now.toISOString()
  t.approval = undefined
  t.todos ??= []
  t.steps ??= []
  // keep creation order: the overview lists threads newest first
  const at = p.threads.findIndex((x) => x.createdAt > t.createdAt)
  if (at < 0) p.threads.push(t)
  else p.threads.splice(at, 0, t)
  refreshArchiveInfo(dir, p)
  return t
}
