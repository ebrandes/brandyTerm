import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2 } from 'lucide-react'
import type { ConnectorView } from '../../../shared/connectors.ts'
import type { Project } from '../types'
import { api } from '../api'
import { report } from '../notice'
import { ConfigureConnector } from './ConfigureConnector'
import { RAILWAY_HINT, entrarArgs, showsEntrar, statusClass } from './status'

interface Props {
  c: ConnectorView
  projects: Project[]
}

function ConfirmRemove({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => void }) {
  // portal: the sidebar's section styles must not leak into the dialog
  return createPortal(
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Remover conector">
      <div className="modal">
        <h3>Remover “{name}”?</h3>
        <p>As chaves e o login guardados deste conector serão apagados. Para usar de novo, será preciso adicioná-lo outra vez.</p>
        <div className="modal-actions">
          <button onClick={onCancel} autoFocus>Cancelar</button>
          <button className="danger" onClick={onConfirm}>Remover</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** One installed connector: status, switch, actions and the tools it may always call. Controls exist only on this machine. */
export function ConnectorRow({ c, projects }: Props) {
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [testing, setTesting] = useState(false)
  const run = (p: Promise<unknown>) => void p.catch(report)

  const test = async () => {
    setTesting(true)
    try {
      await api.connectors.test({ id: c.id })
    } catch (e) {
      report(e)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="conn-row">
      <div className="conn-main">
        <span className={`dot ${c.status === 'conectado' ? 'dot-ok' : c.status === 'erro' ? 'dot-err' : 'dot-off'}`} />
        <span className="conn-name" title={c.description}>{c.name}</span>
        <span className={`conn-chip ${statusClass(c.status)}`}>{c.status}</span>
        {c.toolCount !== undefined && <span className="conn-count">{c.toolCount} ferramentas</span>}
        <label className="conn-switch" title={c.enabled ? 'Desligar' : 'Ligar'}>
          <input type="checkbox" checked={c.enabled} aria-label={`${c.enabled ? 'Desligar' : 'Ligar'} ${c.name}`}
            onChange={(e) => run(api.connectors.enable({ id: c.id, on: e.target.checked }))} />
        </label>
      </div>
      {c.status === 'erro' && c.error && <div className="conn-error">{c.error}</div>}
      {c.status === 'erro' && c.preset === 'railway' && <div className="conn-error">{RAILWAY_HINT}</div>}
      <div className="conn-actions">
        {showsEntrar(c) && (
          <button className="primary-sm" onClick={() => run(api.connectors.login(entrarArgs(c)))}>Entrar</button>
        )}
        <button onClick={() => setEditing((v) => !v)} aria-expanded={editing}>Configurar</button>
        <button onClick={() => void test()} disabled={testing}>
          {testing ? <Loader2 size={11} className="spin" /> : null} Testar
        </button>
        <button className="danger-link" onClick={() => setRemoving(true)}>Remover</button>
      </div>
      {editing && <ConfigureConnector c={c} projects={projects} onDone={() => setEditing(false)} />}
      {c.alwaysAllow.length > 0 && (
        <div className="conn-allow">
          <span>Sempre permitido:</span>
          {c.alwaysAllow.map((t) => (
            <span key={t} className="conn-tool">
              {t}
              <button aria-label={`Parar de permitir ${t}`} title="Voltar a pedir aprovação"
                onClick={() => run(api.connectors.revokeAlways({ id: c.id, tool: t }))}>×</button>
            </span>
          ))}
        </div>
      )}
      {removing && (
        <ConfirmRemove name={c.name} onCancel={() => setRemoving(false)}
          onConfirm={() => { setRemoving(false); run(api.connectors.remove({ id: c.id })) }} />
      )}
    </div>
  )
}
