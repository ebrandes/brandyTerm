// Outgoing WebSocket as a pure Socket. Sends made before the connection opens are queued.
import { WebSocket } from 'ws'
import type { Socket } from '../../shared/remote/protocol.ts'
import { isPrivateIPv4 } from './lan.ts'
import { keepAlive, MAX_PAYLOAD, type KeepTimers } from './ws-keepalive.ts'
import { wsSocket } from './ws-socket.ts'

export const CONNECT_MS = 2000

/** `ip:port` with a private IPv4 (the local network only), or null. */
export function parseAddress(address: string): string | null {
  const m = /^([\d.]+):(\d{1,5})$/.exec(address)
  if (!m || !isPrivateIPv4(m[1]) || +m[2] < 1 || +m[2] > 65535) return null
  return `${m[1]}:${+m[2]}`
}

/** `address` is a private `ip:port`. Throws otherwise; a dead address fails within CONNECT_MS. */
export function dialWs(address: string, timers?: KeepTimers): Socket {
  const addr = parseAddress(address)
  if (!addr) throw new Error('endereço fora da rede local')
  const ws = new WebSocket(`ws://${addr}`, { handshakeTimeout: CONNECT_MS, maxPayload: MAX_PAYLOAD })
  const inner = wsSocket(ws)
  const queued: (Uint8Array | string)[] = []
  ws.on('open', () => {
    keepAlive(ws, timers)
    for (const d of queued.splice(0)) { try { inner.send(d) } catch { /* closing */ } }
  })
  return {
    send(data) {
      if (ws.readyState === ws.CONNECTING) queued.push(data)
      else inner.send(data)
    },
    onMessage: cb => inner.onMessage(cb),
    onClose: cb => inner.onClose(cb),
    close() {
      queued.length = 0
      if (ws.readyState === ws.CONNECTING) ws.terminate()
      else inner.close()
    }
  }
}
