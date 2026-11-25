import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { ImportCandidate } from '../../../shared/connectors.ts'
import { api } from '../api'
import { errorText, report } from '../notice'

const exact = (c: ImportCandidate): string => [c.command, ...(c.args ?? [])].join(' ')

/** Lists the servers in ~/.claude.json (names only) and imports the chosen ones. A stdio entry needs "Confio neste comando". */
export function ImportConnectors({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<ImportCandidate[]>()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [trusted, setTrusted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let alive = true
    void api.connectors.importList().then((l) => alive && setList(l)).catch(report)
    return () => { alive = false }
  }, [])

  const chosen = (list ?? []).filter((c) => picked.has(c.name) && !c.unsupported)
  const needsTrust = chosen.some((c) => c.transport === 'stdio')
  const toggle = (name: string) => setPicked((p) => { const n = new Set(p); if (n.has(name)) n.delete(name); else n.add(name); return n })

  const run = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await api.connectors.import({ names: chosen.map((c) => c.name), trusted })
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  // portal: the sidebar's section styles must not leak into the dialog
  return createPortal(
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Importar do Claude Code">
      <div className="modal conn-modal">
        <header className="conn-modal-head">
          <h3>Importar do Claude Code</h3>
          <button className="icon-btn sm" onClick={onClose} aria-label="Fechar"><X size={14} /></button>
        </header>
        {list === undefined && <p className="conn-hint">Lendo ~/.claude.json…</p>}
        {list?.length === 0 && <p className="conn-hint">Nenhum servidor MCP encontrado em ~/.claude.json.</p>}
        {(list ?? []).map((c) => (
          <label key={c.name} className="conn-import">
            <input type="checkbox" disabled={!!c.unsupported} checked={picked.has(c.name) && !c.unsupported} onChange={() => toggle(c.name)} />
            <span className="conn-name">{c.name}</span>
            <span className="conn-count">{c.transport === 'stdio' ? 'comando' : 'URL'}</span>
            {c.unsupported && <span className="conn-count">{c.unsupported}</span>}
            {!c.unsupported && (c.envKeys?.length || c.headerKeys?.length) ? <span className="conn-count">chaves: {[...(c.envKeys ?? []), ...(c.headerKeys ?? [])].join(', ')}</span> : null}
          </label>
        ))}
        {needsTrust && (
          <div className="conn-exact">
            <span>Serão executados exatamente:</span>
            {chosen.filter((c) => c.transport === 'stdio').map((c) => <code key={c.name}>{exact(c)}</code>)}
            <label className="conn-trust">
              <input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} />
              Confio neste comando
            </label>
          </div>
        )}
        {error && <div className="conn-error">{error}</div>}
        <div className="conn-actions">
          <button onClick={onClose}>Cancelar</button>
          <button className="primary-sm" disabled={busy || chosen.length === 0 || (needsTrust && !trusted)} onClick={() => void run()}>Importar</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
