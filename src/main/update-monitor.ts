// What the app currently knows about updates, fed by repeated checks. No Electron import.
import type { UpdateStatus } from '../shared/update.ts'
import type { CheckResult } from './update-check.ts'

export function createUpdateMonitor(
  version: string, run: () => Promise<CheckResult>, onChange: (s: UpdateStatus) => void
) {
  let current: UpdateStatus = { version, update: null }
  let running: Promise<void> | null = null

  async function once(): Promise<void> {
    const result = await run()
    const next: UpdateStatus = { ...current, ...result }
    if (JSON.stringify(next) === JSON.stringify(current)) return
    current = next
    onChange(current)
  }

  return {
    status: (): UpdateStatus => current,
    /** never rejects; a call during a check joins it */
    check(): Promise<void> {
      running ??= once().catch(() => {}).finally(() => { running = null })
      return running
    }
  }
}
