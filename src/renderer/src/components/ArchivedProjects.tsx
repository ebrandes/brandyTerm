import { useState } from 'react'
import { ChevronRight, RotateCcw } from 'lucide-react'
import type { Project } from '../types'
import { report, showNotice } from '../notice'
import { api } from '../api'

/** the archived projects, at the end of the list, folded by default; each can come back */
export function ArchivedProjects({ projects }: { projects: Project[] }) {
  const [open, setOpen] = useState(false)
  if (!projects.length) return null
  const restore = (id: string) =>
    void api.setProjectArchived({ projectId: id, archived: false }).then((r) => {
      if (r && !r.ok) showNotice(r.error ?? 'Não deu para restaurar o projeto.')
    }, report)
  return (
    <div className="archived-projects">
      <button className="archived-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={12} className={`archived-chev${open ? ' open' : ''}`} />
        <span>Arquivados</span>
        <span className="archived-count">{projects.length}</span>
      </button>
      {open && (
        <ul className="archived-list">
          {projects.map((p) => (
            <li key={p.id} className="archived-row">
              <span className="archived-name" title={p.path ?? undefined}>{p.name}</span>
              {p.machine?.remote && <span className="tag">{p.machine.name}</span>}
              <button className="archived-restore" onClick={() => restore(p.id)} title={`Restaurar ${p.name} na lista`}>
                <RotateCcw size={12} />
                Restaurar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
