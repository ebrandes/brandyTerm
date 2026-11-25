// Limits and liveness shared by the dialing side (ws-dial.ts) and the host server (server.ts).
import type { WebSocket } from 'ws'

export const MAX_PAYLOAD = 36 * 1024 * 1024
export const PING_MS = 10_000
export const PONG_MS = 10_000

export interface KeepTimers {
  set(fn: () => void, ms: number): unknown
  clear(h: unknown): void
}

const real: KeepTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: h => clearTimeout(h as ReturnType<typeof setTimeout>)
}

/** Pings every PING_MS; terminates the socket when no pong arrives within PONG_MS (sleeping peer, lost Wi-Fi). */
export function keepAlive(ws: WebSocket, t: KeepTimers = real): void {
  let timer: unknown = null
  const stop = (): void => { if (timer !== null) t.clear(timer); timer = null }
  const ping = (): void => {
    if (ws.readyState !== ws.OPEN) return
    try { ws.ping() } catch { return ws.terminate() }
    timer = t.set(() => ws.terminate(), PONG_MS)
  }
  ws.on('pong', () => {
    stop()
    timer = t.set(ping, PING_MS)
  })
  ws.on('close', stop)
  timer = t.set(ping, PING_MS)
}
