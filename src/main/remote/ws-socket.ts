// Adapts a `ws` WebSocket to the pure Socket interface (used by the host server and the client).
import type { WebSocket, RawData } from 'ws'
import type { Socket } from '../../shared/remote/protocol.ts'

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data // Buffer is a Uint8Array view; callers must not touch `.buffer` without byteOffset
}

export function wsSocket(ws: WebSocket): Socket {
  let onMsg: ((d: Uint8Array | string) => void) | null = null
  let onClose: (() => void) | null = null
  let closed = false
  const early: (Uint8Array | string)[] = []

  ws.on('message', (data: RawData, isBinary: boolean) => {
    const bytes = toBytes(data)
    const m = isBinary ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8')
    if (onMsg) onMsg(m)
    else early.push(m)
  })
  ws.on('error', () => { /* 'close' follows; an unhandled error would crash the process */ })
  ws.on('close', () => {
    closed = true
    onClose?.()
  })

  return {
    send(data) {
      if (ws.readyState !== ws.OPEN) throw new Error('socket fechado')
      ws.send(data)
    },
    onMessage(cb) {
      onMsg = cb
      while (early.length && onMsg === cb) cb(early.shift()!)
    },
    onClose(cb) {
      onClose = cb
      if (closed) cb()
    },
    close() { try { ws.close() } catch { /* already closed */ } }
  }
}
