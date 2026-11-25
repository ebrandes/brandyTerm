// One transient message for failures of fire-and-forget actions (open a file, open a port). No DOM.
type Listener = (msg: string | null) => void
const subs = new Set<Listener>()

/** The text a user should read for a failed IPC call. */
export const errorText = (e: unknown): string =>
  String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function showNotice(msg: string): void { for (const s of subs) s(msg) }
export function onNotice(cb: Listener): () => void { subs.add(cb); return () => { subs.delete(cb) } }

/** `void api.x().catch(report)`: shows why an action failed. */
export const report = (e: unknown): void => showNotice(errorText(e))
