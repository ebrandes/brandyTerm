import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { MoreHorizontal } from 'lucide-react'
import type { ConnectorView } from '../../../shared/connectors.ts'
import { connectorDot, type DotProject } from '../../../shared/connector-dot.ts'
import { scopeChoices } from '../../../shared/connector-scope-menu.ts'
import type { Project } from '../types'
import { api } from '../api'
import { report } from '../notice'
import { ConfigureConnector } from './ConfigureConnector'
import { ConfirmRemove, ConnectorMenu } from './ConnectorMenu'
import { FixConnector } from './FixConnector'
import { LogsModal } from './LogsModal'
import { RAILWAY_HINT, entrarArgs, showsEntrar } from './status'
import { useConnectorTest } from './useConnectorTest'

interface Props {
  c: ConnectorView
  projects: Project[]
  /** the project in view: the dot says whether this connector is used there */
  here?: DotProject
}

/**
 * One installed connector: dot (status for the project in view), name, tool count and switch. Configurar, Testar,
 * Ver logs and Remover live in its menu (right-click, "⋯", Shift+F10 or the menu key). Controls exist only on this machine.
 */
export function ConnectorRow({ c, projects, here }: Props) {
  const [editing, setEditing] = useState(false)
  const [fixing, setFixing] = useState(false)
  // a saved definition that cannot run: Corrigir (custom ones) or Remover, never hidden
  const canFix = Boolean(c.problem) && !c.preset
  const [removing, setRemoving] = useState(false)
  const [logs, setLogs] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const more = useRef<HTMLButtonElement>(null)
  const t = useConnectorTest(c.id)
  const run = (p: Promise<unknown>) => void p.catch(report)
  const dot = connectorDot(c, here)
  const error = c.status === 'erro' ? c.error : undefined

  const openBelow = () => {
    const r = more.current?.getBoundingClientRect()
    if (r) setMenu({ x: r.left, y: r.bottom + 2 })
  }
  const closeMenu = useCallback((refocus: boolean) => {
    setMenu(null)
    if (refocus) more.current?.focus()
  }, [])
  // events from the menu and the dialog (portals) bubble here too: only the row's own DOM opens the menu
  const ownRow = (e: MouseEvent | KeyboardEvent) => e.currentTarget.contains(e.target as Node)
  const onContextMenu = (e: MouseEvent) => {
    if (!ownRow(e) || (e.target as HTMLElement).closest('.conn-config, .conn-form')) return
    e.preventDefault()
    // the menu key arrives as a contextmenu event at 0,0: open under "⋯" instead
    if (e.clientX === 0 && e.clientY === 0) openBelow()
    else setMenu({ x: e.clientX, y: e.clientY })
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
      if (!ownRow(e) || (e.target as HTMLElement).closest('.conn-config, .conn-form')) return
      e.preventDefault()
      openBelow()
    }
  }

  return (
    <div className={`conn-row${menu ? ' menu-open' : ''}`} onContextMenu={onContextMenu} onKeyDown={onKeyDown}>
      <div className="conn-main">
        <span className={`dot conn-dot ${dot.tone}`} role="img" aria-label={dot.label} title={dot.label} />
        <span className="conn-name" title={c.description ? `${c.name}: ${c.description}` : c.name}>{c.name}</span>
        {c.toolCount !== undefined && (
          <span className="conn-count" title={`${c.toolCount} ferramentas`}>{c.toolCount} ferramentas</span>
        )}
        <label className="conn-switch" title={c.enabled ? 'Desligar em todos os projetos' : 'Ligar'}>
          <input type="checkbox" checked={c.enabled} aria-label={`${c.enabled ? 'Desligar' : 'Ligar'} ${c.name}`}
            onChange={(e) => run(api.connectors.enable({ id: c.id, on: e.target.checked }))} />
        </label>
        <button ref={more} className="conn-more icon-btn sm" onClick={openBelow} aria-haspopup="menu" aria-expanded={!!menu}
          aria-label={`Ações de ${c.name}`} title="Ações (clique direito ou Shift+F10)">
          <MoreHorizontal size={14} />
        </button>
      </div>
      {error && <div className="conn-error" title={error}>{error}</div>}
      {c.status === 'erro' && c.preset === 'railway' && <div className="conn-error">{RAILWAY_HINT}</div>}
      {t.testing && <div className="conn-test" role="status">Testando: conectar e listar ferramentas… {t.elapsed} s</div>}
      {!t.testing && t.found !== undefined && c.status === 'conectado' && (
        <div className="conn-test ok" role="status">Respondeu: {t.found} {t.found === 1 ? 'ferramenta' : 'ferramentas'}</div>
      )}
      {(showsEntrar(c) || canFix) && (
        <div className="conn-actions">
          {showsEntrar(c) && (
            <button className="primary-sm" onClick={() => run(api.connectors.login(entrarArgs(c)))}>Entrar</button>
          )}
          {canFix && (
            <button className="primary-sm" onClick={() => { setFixing((v) => !v); setEditing(false) }} aria-expanded={fixing}>Corrigir</button>
          )}
        </div>
      )}
      {editing && <ConfigureConnector c={c} projects={projects} onDone={() => setEditing(false)} />}
      {fixing && canFix && <FixConnector c={c} onDone={() => setFixing(false)} />}
      {c.alwaysAllow.length > 0 && (
        <div className="conn-allow">
          <span>Sempre permitido:</span>
          {c.alwaysAllow.map((tool) => (
            <span key={tool} className="conn-tool">
              {tool}
              <button aria-label={`Parar de permitir ${tool}`} title="Voltar a pedir aprovação"
                onClick={() => run(api.connectors.revokeAlways({ id: c.id, tool }))}>×</button>
            </span>
          ))}
        </div>
      )}
      {menu && (
        <ConnectorMenu name={c.name} at={menu} testing={t.testing} error={error}
          scope={scopeChoices(c, here)}
          onScope={(patch) => run(api.connectors.update({ id: c.id, patch }))}
          onConfigure={() => { setEditing(true); setFixing(false) }}
          onTest={t.run}
          onLogs={() => setLogs(true)}
          onRemove={() => setRemoving(true)}
          onClose={closeMenu} />
      )}
      {logs && <LogsModal area="mcp" initialQuery={c.name} onClose={() => setLogs(false)} />}
      {removing && (
        <ConfirmRemove name={c.name} onCancel={() => setRemoving(false)}
          onConfirm={() => { setRemoving(false); run(api.connectors.remove({ id: c.id })) }} />
      )}
    </div>
  )
}
