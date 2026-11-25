import { FileText, PenLine } from 'lucide-react'
import type { Attachment } from '../types'
import { attachmentUrl, formatSize } from '../attach'
import { api } from '../api'

/** Files sent with a message: image thumbnails and file chips; click opens them in the default app. */
export function MessageFiles({ items }: { items: Attachment[] }) {
  return (
    <div className="msg-files">
      {items.map((a) =>
        a.kind === 'image' ? (
          <button key={a.id} className="msg-img" onClick={() => void api.openAttachment(a.path)} title={`${a.name} — abrir`}>
            <img src={attachmentUrl(a.path)} alt={a.name} loading="lazy" />
            {a.marked && (
              <span className="msg-img-tag">
                <PenLine size={11} /> marcada
              </span>
            )}
          </button>
        ) : (
          <button key={a.id} className="tray-file" onClick={() => void api.openAttachment(a.path)} title={`${a.name} — abrir`}>
            <FileText size={15} />
            <span className="tray-name">{a.name}</span>
            <span className="tray-size">{formatSize(a.size)}</span>
          </button>
        )
      )}
    </div>
  )
}
