// Outgoing WebSocket as a pure Socket. Sends made before the connection opens are queued.
import { WebSocket } from 'ws'
import type { Socket } from '../../shared/remote/protocol.ts'
import { wsSocket } from './ws-socket.ts'

export const CONNECT_MS = 2000
const ADDRESS = /^[A-Za-z0-9.-]+:\d{1,5}$/

/** `address` is `host:port`. Throws on a malformed address; a dead one fails within CONNECT_MS. */
export function dialWs(address: string): Socket {
  if (!ADDRESS.test(address)) throw new Error('endereço inválido')
  const ws = new WebSocket(`ws://${address}`, { handshakeTimeout: CONNECT_MS, maxPayload: 8 * 1024 * 1024 })
  const inner = wsSocket(ws)
  const queued: (Uint8Array | string)[] = []
  ws.on('open', () => {
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
