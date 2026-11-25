// A handler that serves only this machine's own window. Pure: no Electron.
import { REMOTE_TERMINAL } from '../../shared/remote/messages.ts'
import type { CallCtx } from './registry.ts'

/** A remote device never reaches the ptys or the window's senders: remote terminal is a later phase. */
export function local<A, R>(fn: (a: A, ctx: CallCtx) => R): (a: A, ctx: CallCtx) => R {
  return (a, ctx) => {
    if (ctx.remote) throw new Error(REMOTE_TERMINAL)
    return fn(a, ctx)
  }
}
