import { useState } from 'react'
import { ChevronRight, CircleCheck } from 'lucide-react'
import type { Project, Thread } from '../types'
import { ThreadCard } from './ThreadCard'

interface Props {
  project: Project
  threads: Thread[]
  selectedId?: string
  onSelect: (id: string) => void
  onCancel: (id: string) => void
}

/**
 * Group of resolved threads. Starts collapsed on every mount; the parent keys it by
 * project id, so switching projects (or restarting the app) folds it again. While
 * collapsed, the selected resolved thread (if any) stays visible so it is reachable.
 */
export function ResolvedGroup({ project, threads, selectedId, onSelect, onCancel }: Props) {
  const [open, setOpen] = useState(false)
  const shown = open ? threads : threads.filter((t) => t.id === selectedId)
  const label = `${threads.length} ${threads.length === 1 ? 'resolvida' : 'resolvidas'}`
  const listId = `resolved-${project.id}`

  return (
    <section className="resolved">
      <button
        type="button"
        className="resolved-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Recolher threads resolvidas' : 'Mostrar threads resolvidas'}
      >
        <ChevronRight size={13} className="chev" aria-hidden />
        <CircleCheck size={13} className="ok" aria-hidden /> {label}
      </button>
      {shown.length > 0 && (
        <div className="tcard-grid" id={listId}>
          {shown.map((t) => (
            <ThreadCard key={t.id} t={t} project={project} selected={t.id === selectedId} onSelect={onSelect} onCancel={onCancel} />
          ))}
        </div>
      )}
    </section>
  )
}
