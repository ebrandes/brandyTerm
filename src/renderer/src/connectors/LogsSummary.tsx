import { useEffect, useState } from 'react'
import { LoaderCircle, Sparkles } from 'lucide-react'
import type { LogArea, LogSummary } from '../../../shared/logs.ts'
import { api } from '../api'
import { startSummary } from './summary-session'

/** Haiku's short reading of the log: asked when it appears, cancelled when it goes away. */
export function LogsSummary({ area }: { area: LogArea }) {
  const [summary, setSummary] = useState<LogSummary>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setSummary(undefined)
    return startSummary(api, area, setSummary)
  }, [area, attempt])

  const retry = <button className="logs-btn" onClick={() => setAttempt((n) => n + 1)}>Tentar de novo</button>

  return (
    <section className="logs-summary" aria-label="Resumo do log" aria-live="polite">
      <h4>
        <Sparkles size={13} /> Resumo
        {summary?.cached && <span className="logs-cached">o log não mudou desde este resumo</span>}
      </h4>
      {!summary && <p className="logs-wait"><LoaderCircle size={13} className="spin" /> Resumindo…</p>}
      {summary?.state === 'ok' && <p className="logs-text">{summary.text}</p>}
      {summary?.state === 'empty' && <p className="logs-wait">Log vazio: nada para resumir.</p>}
      {summary?.state === 'error' && (
        <div className="logs-fail" role="alert">
          <p>Não deu para resumir: {summary.error}</p>
          {retry}
        </div>
      )}
      {summary?.state === 'cancelled' && <div className="logs-fail"><p>Resumo cancelado.</p>{retry}</div>}
    </section>
  )
}
