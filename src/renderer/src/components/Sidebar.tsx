import { Folder, FolderPlus, X } from 'lucide-react'
import type { AgentInfo, PluginInfo, Project } from '../types'

interface Props {
  projects: Project[]
  agents: AgentInfo[]
  plugins: PluginInfo[]
  activeId: string
  onSelect: (id: string) => void
  onOpen: () => void
  onRemove: (id: string) => void
}

export function Sidebar({ projects, agents, plugins, activeId, onSelect, onOpen, onRemove }: Props) {
  return (
    <aside className="sidebar">
      <div className="side-head">
        <h2>Projetos</h2>
        <button className="icon-btn" onClick={onOpen} aria-label="Abrir pasta" title="Abrir pasta como projeto">
          <FolderPlus size={16} />
        </button>
      </div>
      <nav className="project-list">
        {projects.map((p) => {
          const running = p.busy || p.threads.some((t) => t.state === 'running')
          const waiting = p.threads.some((t) => t.state === 'waiting')
          return (
            <div key={p.id} className={`project-item${p.id === activeId ? ' active' : ''}`}>
              <button className="project-main" onClick={() => onSelect(p.id)} title={p.path ?? 'Projeto de demonstração'}>
                <Folder size={15} />
                <span className="project-name">{p.name}</span>
                {p.demo && <span className="tag">demo</span>}
                {waiting ? <span className="dot dot-wait" title="Aguardando sua resposta" /> : running && <span className="dot dot-run" title="Em execução" />}
              </button>
              <button className="project-x" aria-label={`Remover ${p.name}`} title="Remover da lista" onClick={() => onRemove(p.id)}>
                <X size={13} />
              </button>
            </div>
          )
        })}
      </nav>

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

      <div className="side-section">
        <h3>Plugins padrão</h3>
        {plugins.map((p) => (
          <div key={p.id} className="agent-row" title={p.dir ?? p.note}>
            <span className={`dot ${p.dir ? 'dot-ok' : 'dot-off'}`} />
            <span>{p.name}</span>
            <span className="agent-note">{p.dir ? (p.version ?? 'ativo') : 'ausente'}</span>
          </div>
        ))}
      </div>
    </aside>
  )
}
