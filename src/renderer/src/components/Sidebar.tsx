import { useState } from 'react'
import { Download, Folder, FolderPlus, Loader2, X } from 'lucide-react'
import type { AccountsState, AgentInfo, PluginInfo, Project, UserPluginsState } from '../types'
import { UserPluginsPanel } from './UserPluginsPanel'
import { AccountsPanel } from './AccountsPanel'
import { ProjectStatusDot } from './ProjectStatusDot'
import logo from '../assets/logo.png'
import { api } from '../api'

interface Props {
  projects: Project[]
  agents: AgentInfo[]
  plugins: PluginInfo[]
  accounts?: AccountsState
  userPlugins?: UserPluginsState
  activeId: string
  /** projectId -> ISO time the project was last open */
  lastSeen?: Record<string, string>
  onSelect: (id: string) => void
  onOpen: () => void
  onRemove: (id: string) => void
}

function PluginRow({ plugin: p, open, onToggle }: { plugin: PluginInfo; open: boolean; onToggle: () => void }) {
  const canInstall = p.optional && !p.dir
  const blocked = p.review?.blocked && !p.dir
  const status = p.installing ? 'revisando…' : p.dir ? (p.version ?? 'ativo') : blocked ? 'bloqueado' : p.optional ? 'opcional' : 'ausente'
  return (
    <div className="plugin-row">
      <button className="agent-row plugin-main" onClick={onToggle} title={p.error ?? (p.installing ? p.note : p.dir) ?? p.note}>
        <span className={`dot ${p.dir ? 'dot-ok' : 'dot-off'}`} />
        <span>{p.name}</span>
        <span className="agent-note">{status}</span>
      </button>
      {canInstall && (open || p.installing) && (
        <button
          className="icon-btn sm"
          disabled={p.installing}
          aria-label={`Instalar ${p.name}`}
          title={`Instalar ${p.name}`}
          onClick={() => void api.installPlugin({ id: p.id })}
        >
          {p.installing ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
        </button>
      )}
      {p.error && open && <div className="plugin-error">{p.error}</div>}
      {p.review && open && (
        <div className={blocked ? 'plugin-error' : 'plugin-review'}>
          Claude Security: {p.review.summary}
          {blocked && ' — instalação parada até você revisar.'}
          <div className="plugin-actions">
            {p.review.report && <button onClick={() => void api.openPluginReport(p.id)}>Ver relatório</button>}
            {blocked && !p.installing && (
              <button className="danger" onClick={() => void api.installPlugin({ id: p.id, force: true })}>
                Instalar mesmo assim
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function Sidebar({ projects, agents, plugins, accounts, userPlugins, activeId, lastSeen, onSelect, onOpen, onRemove }: Props) {
  const [openPlugin, setOpenPlugin] = useState<string | null>(null)
  return (
    <aside className="sidebar">
      <img className="brand" src={logo} alt="BrandyTerm" draggable={false} />
      <div className="side-head">
        <h2>Projetos</h2>
        <button className="icon-btn" onClick={onOpen} aria-label="Abrir pasta" title="Abrir pasta como projeto">
          <FolderPlus size={16} />
        </button>
      </div>
      <nav className="project-list">
        {projects.map((p) => {
          return (
            <div key={p.id} className={`project-item${p.id === activeId ? ' active' : ''}`}>
              <button className="project-main" onClick={() => onSelect(p.id)} title={p.path ?? 'Projeto de demonstração'}>
                <Folder size={15} />
                <span className="project-name">{p.name}</span>
                {p.demo && <span className="tag">demo</span>}
                <ProjectStatusDot project={p} lastSeen={lastSeen?.[p.id]} selected={p.id === activeId} />
              </button>
              <button className="project-x" aria-label={`Remover ${p.name}`} title="Remover da lista" onClick={() => onRemove(p.id)}>
                <X size={13} />
              </button>
            </div>
          )
        })}
      </nav>

      {accounts && <AccountsPanel state={accounts} />}

      <div className="side-section">
        <h3>Agentes</h3>
        {agents.map((a) => (
          <div key={a.id} className="agent-row" title={a.version ?? a.note}>
            <span className={`dot ${a.installed ? 'dot-ok' : 'dot-off'}`} />
            <span>{a.name}</span>
            <span className="agent-note">{a.installed ? 'pronto' : 'não instalado'}</span>
          </div>
        ))}
      </div>

      {(['plugin', 'mcp', 'tool'] as const).map((kind) => (
        <div key={kind} className="side-section">
          <h3>{kind === 'mcp' ? 'MCPs' : kind === 'tool' ? 'Ferramentas' : 'Plugins'}</h3>
          {plugins
            .filter((p) => (p.kind ?? 'plugin') === kind)
            .map((p) => (
              <PluginRow key={p.id} plugin={p} open={openPlugin === p.id} onToggle={() => setOpenPlugin(openPlugin === p.id ? null : p.id)} />
            ))}
        </div>
      ))}

      {userPlugins && <UserPluginsPanel state={userPlugins} />}
    </aside>
  )
}
