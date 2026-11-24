import { CircleAlert, CircleCheck, Clock3, Loader2, MessageCircleQuestion, Square } from 'lucide-react'
import { AGENT_NAMES, EFFORT_LABEL, projectTokens, type Project, type Thread } from '../types'
import { AgentBadge } from './AgentBadge'
import { ProcessPanel } from './ProcessPanel'

const STATE: Record<Thread['state'], { label: string; cls: string }> = {
  running: { label: 'Em execução', cls: 'st-running' },
  waiting: { label: 'Aguardando você', cls: 'st-waiting' },
  done: { label: 'Concluída', cls: 'st-done' },
  queued: { label: 'Em fila', cls: 'st-queued' },
  failed: { label: 'Falhou', cls: 'st-failed' },
  interrupted: { label: 'Interrompida', cls: 'st-failed' },
  cancelled: { label: 'Cancelada', cls: 'st-queued' }
}

function StateIcon({ state }: { state: Thread['state'] }) {
  if (state === 'running') return <Loader2 size={13} className="spin" />
  if (state === 'done') return <CircleCheck size={13} />
  if (state === 'waiting') return <MessageCircleQuestion size={13} />
  if (state === 'failed' || state === 'interrupted') return <CircleAlert size={13} />
  return <Clock3 size={13} />
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',')} mil`
  return String(n)
}

interface Props {
  project: Project
  selectedId?: string
  onSelect: (id: string) => void
  onCancel: (id: string) => void
}

export function Overview({ project, selectedId, onSelect, onCancel }: Props) {
  const count = (s: Thread['state']) => project.threads.filter((t) => t.state === s).length
  const parts: string[] = []
  if (count('running')) parts.push(`${count('running')} em execução`)
  if (count('waiting')) parts.push(`${count('waiting')} aguardando você`)
  if (count('queued')) parts.push(`${count('queued')} em fila`)
  if (count('done')) parts.push(`${count('done')} ${count('done') === 1 ? 'concluída' : 'concluídas'}`)
  const threads = [...project.threads].reverse()
  const measured = project.coordinator.usage.measured || project.threads.some((t) => t.usage.measured)

  return (
    <aside className="overview">
      <header className="overview-header">
        <h2>Visão do projeto</h2>
        <p>{parts.length ? parts.join(' · ') : 'Sem atividade'}</p>
      </header>

      <div className="thread-list">
        {threads.length === 0 && (
          <p className="empty small">As threads criadas pelo coordenador aparecem aqui. Clique em uma para falar direto com ela.</p>
        )}
        {threads.map((t) => {
          const open = t.state === 'running' || t.state === 'queued' || t.state === 'waiting'
          const todos = t.todos ?? []
          const done = todos.filter((x) => x.status === 'completed').length
          return (
            <article
              key={t.id}
              className={`thread-card${t.id === selectedId ? ' selected' : ''}`}
              onClick={() => !project.demo && onSelect(t.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !project.demo && onSelect(t.id)}
            >
              <div className="thread-top">
                <h3>{t.title}</h3>
                <span className={`state ${STATE[t.state].cls}`}>
                  <StateIcon state={t.state} />
                  {STATE[t.state].label}
                </span>
              </div>
              <div className="thread-meta">
                <AgentBadge agent={t.agent} size="sm" />
                <span>
                  {AGENT_NAMES[t.agent]}
                  {t.model ? ` ${t.model}` : ''} <span className="sep">·</span> {EFFORT_LABEL[t.effort]}
                </span>
                {todos.length > 0 && (
                  <span className="progress">
                    {done}/{todos.length}
                  </span>
                )}
              </div>
              {todos.length > 0 && open && (
                <div className="bar">
                  <i style={{ width: `${(done / todos.length) * 100}%` }} />
                </div>
              )}
              {(t.note || t.summary) && <p className="thread-note">{open || t.state !== 'done' ? t.note : t.summary}</p>}
              {open && !project.demo && (
                <button
                  className="cancel"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCancel(t.id)
                  }}
                >
                  <Square size={10} /> Cancelar
                </button>
              )}
            </article>
          )
        })}
      </div>

      <ProcessPanel project={project} />

      <footer className="overview-footer">
        <span>Tokens do projeto{measured ? '' : ' (sem medição)'}</span>
        <strong>{formatTokens(projectTokens(project))}</strong>
      </footer>
    </aside>
  )
}
