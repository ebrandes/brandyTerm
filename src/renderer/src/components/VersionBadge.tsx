import { useEffect, useRef, useState } from 'react'
import type { UpdateStatus } from '../../../shared/update.ts'
import { api } from '../api'
import { noticeTitle, terminalName, versionTitle } from '../version-labels'
import './version-badge.css'

function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    let pushed = false
    const off = api.update.onChange((s) => { pushed = true; setStatus(s) })
    // a push that arrives first is newer than the answer
    api.update.get().then((s) => { if (!pushed) setStatus(s) }, () => {})
    return off
  }, [])
  return status
}

/** next to the logo: the running version and, when there is something newer, the "Atualização" chip */
export function VersionBadge() {
  const status = useUpdateStatus()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const notice = status?.update ?? null

  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [open])

  if (!status) return null

  const click = () => {
    if (notice?.kind === 'release') void api.update.openRelease()
    else {
      setCopied(false)
      setOpen((v) => !v)
    }
  }

  return (
    <div className="version-box" ref={box}>
      <span className="version-text" title={versionTitle(status)}>v{status.version}</span>
      {notice && (
        <button className="update-chip" onClick={click} title={noticeTitle(notice)}
          aria-expanded={notice.kind === 'git' ? open : undefined}>
          Atualização
        </button>
      )}
      {open && notice?.kind === 'git' && (
        <div className="update-pop" role="dialog" aria-label="Atualização disponível">
          <p>{noticeTitle(notice)}.</p>
          <p>Rode no {terminalName(api.platform)}, na pasta do BrandyTerm:</p>
          <div className="update-cmd">
            <code>{notice.command}</code>
            <button onClick={() => void api.term.writeClipboard(notice.command).then(() => setCopied(true))}>
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
