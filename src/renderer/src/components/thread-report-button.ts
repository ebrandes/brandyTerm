import type { Thread } from '../../../shared/types.ts'

export type ReportButtonState = 'hidden' | 'disabled' | 'busy' | 'ready' | 'sent'

/** State of the "send summary to the coordinator" button of a thread. */
export function reportButtonState(t: Thread): ReportButtonState {
  if (t.state !== 'done' || t.retired) return 'hidden'
  if (!t.sessionId) return 'disabled'
  if (t.reporting) return 'busy'
  if (t.reportedAt) {
    const reported = Date.parse(t.reportedAt)
    const lastUser = [...(t.messages ?? [])].reverse().find((m) => m.author === 'user')
    if (!lastUser || reported > Date.parse(lastUser.time)) return 'sent'
  }
  return 'ready'
}
