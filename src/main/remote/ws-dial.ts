// Outgoing WebSocket as a pure Socket. Sends made before the connection opens are queued.
import { WebSocket } from 'ws'
import type { Socket } from '../../shared/remote/protocol.ts'
import { isPrivateIPv4 } from './lan.ts'
import { keepAlive, MAX_PAYLOAD, type KeepTimers } from './ws-keepalive.ts'
import { wsSocket } from './ws-socket.ts'

export const CONNECT_MS = 2000

/** `ip:port` with a private IPv4 (the local network only), or null. Output is canonical (no leading zeros: ws would read them as octal). */
export function parseAddress(address: string): string | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/.exec(address)
  if (!m) return null
  const octets = m.slice(1, 5)
  if (octets.some(o => o.length > 1 && o.startsWith('0'))) return null
  const ip = octets.map(Number).join('.')
  const port = Number(m[5])
  if (!isPrivateIPv4(ip) || port < 1 || port > 65535) return null
  return `${ip}:${port}`
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
