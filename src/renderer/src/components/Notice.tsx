import { useEffect, useState } from 'react'
import { onNotice } from '../notice'

/** The failure message of the last open-file / open-port action; clears itself. Mount once. */
export function Notice() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const off = onNotice((m) => {
      setMsg(m)
      clearTimeout(t)
      t = setTimeout(() => setMsg(null), 6000)
    })
    return () => { off(); clearTimeout(t) }
  }, [])
  if (!msg) return null
  return <div className="toast" role="alert" onClick={() => setMsg(null)}>{msg}</div>
}
