import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppSettings, Project } from '../shared/types.ts'
import { mergeLastSeen, seedLastSeen } from './last-seen.ts'
import { DEFAULT_IDLE_COMPACT } from '../shared/idle.ts'

/** App-wide preferences, kept in userData/settings.json so they survive restarts. */

let settings: AppSettings = {}
const file = () => join(app.getPath('userData'), 'settings.json')
const save = () => writeFileSync(file(), JSON.stringify(settings, null, 2))

/** `projects` carries the old per-project "permitir tudo" switch into the app setting once. */
export function loadSettings(projects: Project[]): AppSettings {
  try {
    settings = JSON.parse(readFileSync(file(), 'utf8')) as AppSettings
  } catch {
    settings = { allowAllThreads: projects.some((p) => (p as { allowAllThreads?: boolean }).allowAllThreads) || undefined }
  }
  const lastSeen = seedLastSeen(settings.lastSeen, projects, new Date().toISOString())
  if (lastSeen) {
    settings = { ...settings, lastSeen }
    save()
  }
  return settings
}

export function appSettings(): AppSettings {
  return settings
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next: AppSettings = { ...settings }
  if ('allowAllThreads' in patch) next.allowAllThreads = !!patch.allowAllThreads || undefined
  if ('lastProjectId' in patch) next.lastProjectId = typeof patch.lastProjectId === 'string' ? patch.lastProjectId : undefined
  if ('lastSeen' in patch) next.lastSeen = mergeLastSeen(settings.lastSeen, patch.lastSeen)
  if ('keepAwake' in patch) next.keepAwake = patch.keepAwake !== false
  if ('idleCompact' in patch && patch.idleCompact) next.idleCompact = { ...DEFAULT_IDLE_COMPACT, ...patch.idleCompact }
  settings = next
  save()
  return settings
}
