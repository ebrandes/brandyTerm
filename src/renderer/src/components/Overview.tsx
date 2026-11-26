import { LayoutGrid } from 'lucide-react'
import type { Project, Thread } from '../types'
import { ThreadCard } from './ThreadCard'
import { ResolvedGroup } from './ResolvedGroup'
import { OverviewDock } from './OverviewDock'

interface Props {
  project: Project
  selectedId?: string
  onSelect: (id: string) => void
  onCancel: (id: string) => void
  onBoard: () => void
  /** app setting: new threads start with "permitir tudo" */
  allowAllThreads: boolean
  /** app setting: keep the machine awake while work runs */
  keepAwake: boolean
  /** app setting: native notifications */
  notifications: boolean
  /** app setting: compact an idle coordinator's context */
  idleCompact: boolean
  /** remote access is on or another machine is paired (showRemoteToggle) */
  showRemote: boolean
}

export function Overview(props: Props) {
  const { project, selectedId, onSelect, onCancel, onBoard, allowAllThreads, keepAwake, notifications, idleCompact, showRemote } = props
  const count = (s: Thread['state']) => project.threads.filter((t) => t.state === s).length
  const parts: string[] = []
  if (count('running')) parts.push(`${count('running')} em execução`)
  const asking = project.threads.filter((t) => t.state === 'waiting' || t.approval).length
  if (asking) parts.push(`${asking} aguardando você`)
  if (count('queued')) parts.push(`${count('queued')} em fila`)
  const pending = project.threads.filter((t) => t.state === 'done' && t.pending).length
  if (pending) parts.push(`${pending} ${pending === 1 ? 'pendente' : 'pendentes'}`)
  const resolvedCount = project.threads.filter((t) => t.state === 'done' && !t.pending).length
  if (resolvedCount) parts.push(`${resolvedCount} ${resolvedCount === 1 ? 'resolvida' : 'resolvidas'}`)
  const threads = [...project.threads].reverse()
  // auto-resolve: finished threads with nothing pending fold away; pending ones stay in view
  // superseded or discarded threads fold away with them
  const folded = (t: Thread) => (t.state === 'done' && t.resolved) || !!t.retired
  const resolved = threads.filter(folded)
  const active = threads.filter((t) => !folded(t))

  return (
    <aside className="overview" id="overview">
      <header className="overview-header">
        <div className="overview-title">
          <h2>Visão do projeto</h2>
          <button className="icon-btn" onClick={onBoard} aria-label="Abrir quadro dos agentes" title="Quadro dos agentes (⌘B)">
            <LayoutGrid size={15} />
          </button>
        </div>
        <p>{parts.length ? parts.join(' · ') : 'Sem atividade'}</p>
      </header>

      <div className="thread-list">
        {threads.length === 0 && (
          <p className="empty small">As threads criadas pelo coordenador aparecem aqui. Clique em uma para falar direto com ela.</p>
        )}
        {active.length > 0 && (
          <div className="tcard-grid">
            {active.map((t) => (
              <ThreadCard key={t.id} t={t} project={project} selected={t.id === selectedId} onSelect={onSelect} onCancel={onCancel} />
            ))}
          </div>
        )}
        {resolved.length > 0 && (
          // key: remounts (and folds) the group whenever the user enters another project
          <ResolvedGroup key={project.id} project={project} threads={resolved} selectedId={selectedId} onSelect={onSelect} onCancel={onCancel} />
        )}
      </div>

      <OverviewDock
        project={project}
        allowAllThreads={allowAllThreads}
        keepAwake={keepAwake}
        notifications={notifications}
        idleCompact={idleCompact}
        showRemote={showRemote}
      />
    </aside>
  )
}
