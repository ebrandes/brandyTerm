// Whether a thread's summary already reached the coordinator. Shared by the button and by main.
import type { Project, Thread } from './types.ts'

/** the mark counts only for the current turn: newer than the last thing the user said to the thread */
export function summarySent(t: Thread): boolean {
  if (!t.reportedAt) return false
  const lastUser = [...(t.messages ?? [])].reverse().find((m) => m.author === 'user')
  return !lastUser || Date.parse(t.reportedAt) > Date.parse(lastUser.time)
}

export function markSent(t: Thread, at: string): void {
  t.reportedAt = at
  t.reportError = undefined
}

/** marks finished threads whose summary the system had already posted before the mark was recorded */
export function backfillSent(p: Project): void {
  for (const t of p.threads) {
    if (t.state !== 'done' || summarySent(t)) continue
    // only a card posted after the thread's last turn settled
    const card = [...p.messages].reverse().find((m) => m.summaries?.some((s) => s.threadId === t.id))
    if (!card || !(Date.parse(card.time) >= Date.parse(t.updatedAt))) continue
    const candidate = { ...t, reportedAt: card.time }
    if (summarySent(candidate)) markSent(t, card.time)
  }
}
