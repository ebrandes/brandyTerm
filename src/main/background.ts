import type { Engine } from './engine.ts'
import { appSettings } from './settings.ts'
import { KeepAwake } from './keep-awake.ts'
import { startIdleCompact } from './idle-compact.ts'
import { DEFAULT_IDLE_COMPACT } from '../shared/idle.ts'

/** Wires keep-awake (on every engine change) and idle compaction (timer) to the app settings. */
export function startBackground(e: Engine): () => void {
  const awake = new KeepAwake()
  const syncAwake = () => awake.sync(e.state.projects, appSettings().keepAwake !== false)
  e.on('change', syncAwake)
  syncAwake()
  const stopIdle = startIdleCompact(e, () => ({ ...DEFAULT_IDLE_COMPACT, ...appSettings().idleCompact }))
  return () => {
    stopIdle()
    awake.sync([], false)
  }
}
