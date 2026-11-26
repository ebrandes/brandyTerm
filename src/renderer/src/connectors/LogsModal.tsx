import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, RefreshCw, X } from 'lucide-react'
import { filterEntries, type LogArea, type LogEntry, type LogLevel } from '../../../shared/logs.ts'
import { revealLabel } from '../../../shared/project-menu-labels.ts'
import { api } from '../api'
import { report } from '../notice'
import { LEVEL_LABEL, LogEntryRow } from './LogEntryRow'
import { LogsSummary } from './LogsSummary'
import './logs-modal.css'

const LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug']
const PAGE = 300

interface Props {
  area: LogArea
  /** the connector it was opened from: the search starts with its name */
  initialQuery?: string
  onClose: () => void
}

// the portal's events still bubble through React to the row that opened it
const keepInside = (e: SyntheticEvent) => e.stopPropagation()

export function LogsModal(props: Props) {
  return createPortal(<LogsDialog {...props} />, document.body)
}

function LogsDialog({ area, initialQuery = '', onClose }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>()
  const [failure, setFailure] = useState<string>()
  const [query, setQuery] = useState(initialQuery)
  const [levels, setLevels] = useState<LogLevel[]>([])
  const [shown, setShown] = useState(PAGE)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let current = true
    setFailure(undefined)
    api.readLogs(area).then(
      (r) => { if (current) setEntries([...r.entries].reverse()) },
      (e) => { if (current) setFailure(e instanceof Error ? e.message : String(e)) }
    )
    return () => { current = false }
  }, [area, reload])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const found = useMemo(() => filterEntries(entries ?? [], { query, levels }), [entries, query, levels])
  useEffect(() => setShown(PAGE), [query, levels])
  const toggle = useCallback((level: LogLevel) => {
    setLevels((all) => (all.includes(level) ? all.filter((l) => l !== level) : [...all, level]))
  }, [])

  return (
    <div className="modal-back logs-back" onClick={keepInside} onContextMenu={keepInside}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal logs-modal" role="dialog" aria-modal="true" aria-label={`Logs: ${area}`}>
        <header className="logs-head">
          <h3>Logs: {area}</h3>
          <button className="logs-btn" onClick={() => void api.openLogs().catch(report)}>
            <FolderOpen size={13} /> {revealLabel(api.platform)}
          </button>
          <button className="icon-btn" onClick={() => setReload((n) => n + 1)} aria-label="Atualizar lista" title="Atualizar lista">
            <RefreshCw size={14} />
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar" title="Fechar"><X size={16} /></button>
        </header>
        <LogsSummary area={area} />
        <div className="logs-controls">
          <input type="search" value={query} autoFocus placeholder="Pesquisar no log" aria-label="Pesquisar no log"
            onChange={(e) => setQuery(e.target.value)} />
          <div className="logs-levels" role="group" aria-label="Filtrar por nível">
            {LEVELS.map((l) => (
              <button key={l} className={`logs-level ${l}`} aria-pressed={levels.includes(l)} onClick={() => toggle(l)}>
                {LEVEL_LABEL[l]}
              </button>
            ))}
          </div>
        </div>
        <div className="logs-body">
          {failure && <p className="logs-note" role="alert">Não deu para ler o log: {failure}</p>}
          {!failure && !entries && <p className="logs-note">Lendo…</p>}
          {!failure && entries && entries.length === 0 && <p className="logs-note">Log vazio.</p>}
          {!failure && !!entries?.length && found.length === 0 && <p className="logs-note">Nada encontrado com este filtro.</p>}
          {!failure && found.length > 0 && (
            <ul className="logs-list">
              {found.slice(0, shown).map((e, i) => <LogEntryRow key={`${e.ts}-${found.length - i}`} entry={e} />)}
            </ul>
          )}
          {!failure && found.length > shown && (
            <button className="logs-btn" onClick={() => setShown((n) => n + PAGE)}>Mostrar mais ({found.length - shown})</button>
          )}
        </div>
      </div>
    </div>
  )
}
