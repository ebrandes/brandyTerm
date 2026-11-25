// One deadline per gateway request: the login wait and the approval wait share it, and the agent's cancel ends it at once.
import { CALL_CANCELLED } from './gateway-protocol.ts'

export const TIMED_OUT = 'Tempo esgotado esperando aprovação'
export const CANCELLED = CALL_CANCELLED

export interface Deadline {
  /** aborts when the request is cancelled or the time is up */
  readonly signal: AbortSignal
  timedOut(): boolean
  /** stops the timer and lets go of the request signal */
  end(): void
}

export function startDeadline(request: AbortSignal, ms: number): Deadline {
  const ctl = new AbortController()
  let late = false
  const timer = setTimeout(() => { late = true; ctl.abort() }, ms)
  timer.unref?.()
  const onAbort = () => ctl.abort()
  if (request.aborted) ctl.abort()
  else request.addEventListener('abort', onAbort, { once: true })
  return {
    signal: ctl.signal,
    timedOut: () => late,
    end: () => { clearTimeout(timer); request.removeEventListener('abort', onAbort) },
  }
}

export class HoldError extends Error {}

const why = (dl: Deadline) => new HoldError(dl.timedOut() ? TIMED_OUT : CANCELLED)

/** Waits for the user's answer until the deadline; the ask is always aborted on the way out, which takes its card away. */
export async function hold<T>(ask: (signal: AbortSignal) => Promise<T>, dl: Deadline): Promise<T> {
  if (dl.signal.aborted) throw why(dl)
  const ctl = new AbortController()
  let onAbort = () => {}
  const stop = new Promise<never>((_, reject) => {
    onAbort = () => reject(why(dl))
    dl.signal.addEventListener('abort', onAbort, { once: true })
  })
  stop.catch(() => {})
  try {
    return await Promise.race([ask(ctl.signal), stop])
  } finally {
    dl.signal.removeEventListener('abort', onAbort)
    ctl.abort()
  }
}
