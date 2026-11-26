import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BarChart3, X } from 'lucide-react'
import type { MonthReport } from '../../../shared/usage-report.ts'
import { api } from '../api'
import { report as notify } from '../notice'
import { UsageQuality, UsageSavings, UsageSpend } from './UsageTables'
import './usage-report.css'

/** the sidebar button and the dialog with this machine's monthly report */
export function UsageReportButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="usage-open" onClick={() => setOpen(true)}>
        <BarChart3 size={13} />
        <span>Consumo do mês</span>
      </button>
      {open && createPortal(<UsageDialog onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

function UsageDialog({ onClose }: { onClose: () => void }) {
  const [month, setMonth] = useState<string>()
  const [data, setData] = useState<MonthReport>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let current = true
    setFailed(false)
    api.usageReport(month).then(
      (r) => { if (current) setData(r) },
      (e) => { if (current) { setFailed(true); notify(e) } }
    )
    return () => { current = false }
  }, [month])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const loading = !failed && (!data || (!!month && data.month !== month))
  return (
    <div className="modal-back usage-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal usage-modal" role="dialog" aria-modal="true" aria-label="Consumo do mês">
        <header className="usage-head">
          <h3>Consumo do mês</h3>
          {data && (
            <select value={month ?? data.month} onChange={(e) => setMonth(e.target.value)} aria-label="Mês">
              {data.months.map((m) => <option key={m} value={m}>{m.slice(5)}/{m.slice(0, 4)}</option>)}
            </select>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="Fechar" title="Fechar"><X size={16} /></button>
        </header>
        <div className="usage-body">
          {failed && <p>Não deu para montar o relatório.</p>}
          {loading && <p>Calculando…</p>}
          {!failed && !loading && data && (
            <>
              <UsageQuality report={data} />
              <UsageSavings report={data} />
              <UsageSpend report={data} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
