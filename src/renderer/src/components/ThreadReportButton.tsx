import { Loader2, Send } from 'lucide-react'
import type { Thread } from '../types'
import { api } from '../api'
import { reportButtonState } from './thread-report-button'
import './attention.css'

export function ThreadReportButton({ t, projectId }: { t: Thread; projectId: string }) {
  const state = reportButtonState(t)
  if (state === 'hidden') return null
  const send = () => void api.reportThread({ projectId, threadId: t.id })
  return (
    <div className="attn-actions pad">
      {state === 'busy' ? (
        <button disabled>
          <Loader2 size={14} className="spin" /> Escrevendo resumo…
        </button>
      ) : state === 'disabled' ? (
        <button disabled title="A thread ainda não conversou">
          <Send size={14} /> Enviar resumo ao coordenador
        </button>
      ) : (
        <button onClick={send}>
          <Send size={14} /> {state === 'sent' ? 'Resumo enviado' : 'Enviar resumo ao coordenador'}
        </button>
      )}
    </div>
  )
}
