import { useState } from 'react'
import { Check, Loader2, RotateCcw, Send } from 'lucide-react'
import type { Thread } from '../types'
import { api } from '../api'
import { reportButtonView, type ReportClick } from './thread-report-button'
import './attention.css'
import './thread-report-button.css'

/** give it a key per thread: the click in flight belongs to one thread only */
export function ThreadReportButton({ t, projectId }: { t: Thread; projectId: string }) {
  const [click, setClick] = useState<ReportClick>({})
  const view = reportButtonView(t, click)
  if (view.state === 'hidden') return null
  const send = () => {
    if (view.inactive) return
    setClick({ pending: true })
    api.reportThread({ projectId, threadId: t.id }).then(
      // the new thread state is pushed a moment after the reply: stay on "sending" until then
      () => setTimeout(() => setClick({}), 300),
      (e: unknown) => setClick({ error: e instanceof Error ? e.message : String(e) })
    )
  }
  const Icon = view.state === 'busy' ? Loader2 : view.state === 'sent' ? Check : view.state === 'error' ? RotateCcw : Send
  return (
    <div className="attn-actions pad thread-report">
      {/* aria-disabled instead of disabled: stays focusable and keeps the tooltip */}
      <button className={`report-${view.state}`} onClick={send} aria-disabled={view.inactive} title={view.title}>
        <Icon size={14} className={view.state === 'busy' ? 'spin' : undefined} aria-hidden="true" /> {view.label}
      </button>
      {/* always mounted, so screen readers announce what changes in it */}
      <span className="report-status" aria-live="polite">
        {view.error ? <span className="report-error">{view.error}</span> : <span className="sr-only">{announce(view.state)}</span>}
      </span>
    </div>
  )
}

const announce = (state: string): string =>
  state === 'busy' ? 'Enviando o resumo ao coordenador' : state === 'sent' ? 'Resumo enviado ao coordenador' : ''
