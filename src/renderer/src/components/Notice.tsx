import { useEffect, useState } from 'react'
import { onNotice, type NoticeKind } from '../notice'

/** The failure message of the last open-file / open-port action; clears itself. Mount once. */
export function Notice() {
  const [msg, setMsg] = useState<string | null>(null)
  const [kind, setKind] = useState<NoticeKind>('error')
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const off = onNotice((m, k) => {
      setMsg(m)
      setKind(k ?? 'error')
      clearTimeout(t)
      t = setTimeout(() => setMsg(null), 6000)
    })
    return () => { off(); clearTimeout(t) }
  }, [])
  if (!msg) return null
  return (
    <div className={`toast${kind === 'ok' ? ' ok' : ''}`} role={kind === 'ok' ? 'status' : 'alert'} onClick={() => setMsg(null)}>
      {msg}
    </div>
  )
}
