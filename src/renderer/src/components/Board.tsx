import { modelLabel } from '../../../shared/thread-phase'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { AGENT_NAMES, EFFORT_LABEL, type Project, type Thread } from '../types'
import { AgentBadge } from './AgentBadge'
import { BoardDetail, ago } from './BoardDetail'
import { BoardArchive } from './BoardArchive'
import './board.css'

/** capped columns show the newest FIRST cards; "Mostrar mais" adds MORE at a time */
const FIRST = 10
const MORE = 20
const COLUMNS: { title: string; states: Thread['state'][]; capped?: boolean }[] = [
  { title: 'Em fila', states: ['queued'] },
  { title: 'Em execução', states: ['running'] },
  { title: 'Aguardando você', states: ['waiting'] },
  { title: 'Concluídas', states: ['done'], capped: true },
  { title: 'Falhas e canceladas', states: ['failed', 'interrupted', 'cancelled'], capped: true }
]

export interface BoardItem {
  project: Project
  thread: Thread
}

interface Props {
  projects: Project[]
  currentId: string
  onOpenThread: (projectId: string, threadId: string) => void
  onClose: () => void
}

function Card({ item, showProject, selected, now, onSelect }: { item: BoardItem; showProject: boolean; selected: boolean; now: number; onSelect: () => void }) {
  const t = item.thread
  const todos = t.todos ?? []
  const done = todos.filter((x) => x.status === 'completed').length
  const current = todos.find((x) => x.status === 'in_progress')?.text
  const text = t.state === 'waiting' ? t.question?.text : t.state === 'done' ? t.summary : t.state === 'running' ? (t.steps.at(-1) ?? t.note) : t.note
  return (
    <button className={`board-card${selected ? ' selected' : ''}`} onClick={onSelect} title={t.objective}>
      {showProject && <span className="board-project">{item.project.name}</span>}
      <strong>{t.title}</strong>
      <span className="board-meta">
        <AgentBadge agent={t.agent} size="sm" />
        {AGENT_NAMES[t.agent]}
        {modelLabel(t) ? ` ${modelLabel(t)}` : ''} · {EFFORT_LABEL[t.effort]}
        {todos.length > 0 && <em>{done}/{todos.length}</em>}
      </span>
      {todos.length > 0 && t.state === 'running' && (
        <span className="board-bar">
          <i style={{ width: `${(done / todos.length) * 100}%` }} />
        </span>
      )}
      {current && t.state === 'running' && <span className="board-now">▸ {current}</span>}
      {text && <span className="board-note">{text}</span>}
      {t.state === 'running' && <span className="board-age">última ação {ago(t.updatedAt, now)}</span>}
    </button>
  )
}

/** Live kanban of what the agents are doing, for this project or all of them. */
export function Board({ projects, currentId, onOpenThread, onClose }: Props) {
  const [all, setAll] = useState(false)
  const [pick, setPick] = useState<string | null>(null)
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [archive, setArchive] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => {
      clearInterval(id)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])

  const scope = all ? projects.filter((p) => !p.demo || p.id === currentId) : projects.filter((p) => p.id === currentId)
  const items: BoardItem[] = scope.flatMap((project) => project.threads.map((thread) => ({ project, thread })))
  const selected = items.find((i) => i.thread.id === pick)
  const count = (s: Thread['state']) => items.filter((i) => i.thread.state === s).length
  const head = [`${count('running')} em execução`, `${count('waiting')} aguardando você`, `${count('queued')} em fila`].join(' · ')
  const archived = scope.reduce((n, p) => n + (p.archived?.count ?? 0), 0)
  const switchScope = (v: boolean) => {
    setAll(v)
    setLimits({})
  }
  const card = (i: BoardItem) => (
    <Card
      key={i.thread.id}
      item={i}
      showProject={all}
      now={now}
      selected={i.thread.id === pick}
      onSelect={() => {
        setArchive(false)
        setPick(pick === i.thread.id ? null : i.thread.id)
      }}
    />
  )

  return (
    <div className="board-back" role="dialog" aria-modal="true" aria-label="Quadro dos agentes">
      <div className="board">
        <header className="board-head">
          <div>
            <h2>Agentes · {all ? 'todos os projetos' : scope[0]?.name}</h2>
            <p>
              {head}
              {archived > 0 && (
                <>
                  {' · '}
                  <button className="board-link" onClick={() => setArchive((v) => !v)} aria-expanded={archive}>
                    Arquivadas ({archived})
                  </button>
                </>
              )}
            </p>
          </div>
          <div className="board-tabs" role="tablist">
            <button role="tab" aria-selected={!all} className={!all ? 'on' : ''} onClick={() => switchScope(false)}>Este projeto</button>
            <button role="tab" aria-selected={all} className={all ? 'on' : ''} onClick={() => switchScope(true)}>Todos</button>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar quadro" autoFocus>
            <X size={16} />
          </button>
        </header>
        <div className={`board-body${selected || archive ? ' with-detail' : ''}`}>
          <div className="board-cols">
            {COLUMNS.map((c) => {
              const col = items.filter((i) => c.states.includes(i.thread.state)).sort((a, b) => b.thread.updatedAt.localeCompare(a.thread.updatedAt))
              const cap = c.capped ? (limits[c.title] ?? FIRST) : col.length
              // the selected thread stays reachable even when it falls past the cap
              const extra = col.slice(cap).find((i) => i.thread.id === pick)
              const rest = col.length - cap
              return (
                <section key={c.title} className="board-col">
                  <h3>
                    {c.title} <span>{col.length}</span>
                  </h3>
                  {col.slice(0, cap).map(card)}
                  {extra && card(extra)}
                  {rest > 0 && (
                    <button className="board-more" onClick={() => setLimits({ ...limits, [c.title]: cap + MORE })}>
                      Mostrar mais ({rest})
                    </button>
                  )}
                </section>
              )
            })}
          </div>
          {archive && (
            <BoardArchive
              key={`${scope.map((p) => p.id).join(',')}:${archived}`}
              projectIds={scope.map((p) => p.id)}
              showProject={all}
              now={now}
              onClose={() => setArchive(false)}
              onReopened={(id) => {
                setArchive(false)
                setPick(id)
              }}
            />
          )}
          {selected && !archive && (
            <BoardDetail
              item={selected}
              now={now}
              onClose={() => setPick(null)}
              onOpen={() => onOpenThread(selected.project.id, selected.thread.id)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
