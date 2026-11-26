// What the remote access code shares to write its diagnostic log.
import { diagLog } from '../diag-log.ts'

/** Enough of a public key to tell devices apart. */
export const deviceTag = (pub: string): string => pub.slice(0, 8)

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Only the outcome: the reply carries the proof of the pairing code. */
export function pairOutcome(res: { reply: string; paired: boolean }): void {
  if (res.paired) return diagLog('remote', 'info', 'dispositivo pareado')
  let reason: unknown
  try { reason = JSON.parse(res.reply).reason } catch { reason = undefined }
  diagLog('remote', 'warn', 'pareamento recusado', { reason })
}
