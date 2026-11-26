import type { ApplyItem, ApplyQueueView } from '../../../shared/apply-queue.ts'
import { waitingLabel } from '../../../shared/apply-queue.ts'
import { api } from '../api'
import { report } from '../notice'
import type { Project } from '../types'
import './apply-queue.css'

/** the line under a request's title; `ahead` are the approved or failed ones before it */
function statusLine(item: ApplyItem, running: number, ahead: ApplyItem[]): string {
  if (item.status === 'approval') return 'aguardando sua aprovação'
  if (item.status === 'applying') return 'aplicando…'
  if (item.status === 'applied') return 'aplicado'
  if (item.status === 'failed') return item.error ?? 'falhou'
  if (ahead.some((i) => i.status === 'failed')) return 'parada: resolva a que falhou antes'
  return ahead.length ? `na fila (${ahead.length + 1}ª)` : waitingLabel(running)
}

function Row({ item, project, line }: { item: ApplyItem; project?: string; line: string }) {
  const run = (action: (id: string) => Promise<void>) => () => void action(item.id).catch(report)
  const files = `${item.worktree}\n${item.branch} · ${item.head.slice(0, 8)}\n\n${item.files.join('\n')}`
  return (
    <li className={`aq-item aq-${item.status}`}>
      <div className="aq-title" title={files}>{item.title}</div>
      <div className="aq-sub" title={files}>
        {project ? `${project} · ` : ''}{item.files.length === 1 ? '1 arquivo' : `${item.files.length} arquivos`}
      </div>
      <div className="aq-status" role="status" title={line}>{line}</div>
      {item.status !== 'applying' && (
        <div className="aq-actions">
          {item.status === 'approval' && <button className="aq-main" onClick={run((id) => api.approveApply(id))}>Aprovar</button>}
          {item.status === 'failed' && <button className="aq-main" onClick={run((id) => api.retryApply(id))}>Tentar de novo</button>}
          <button onClick={run((id) => api.cancelApply(id))}>
            {item.status === 'applied' ? 'OK' : item.status === 'pending' ? 'Cancelar' : 'Descartar'}
          </button>
        </div>
      )}
    </li>
  )
}

/** Sidebar "Aplicações": worktrees waiting to go into a project folder. Hidden while there are none. */
export function ApplyQueuePanel({ queue, projects }: { queue?: ApplyQueueView; projects: Project[] }) {
  if (!queue?.items.length) return null
  const blocking = queue.items.filter((i) => i.status === 'pending' || i.status === 'failed' || i.status === 'applying')
  return (
    <section className="aq" aria-label="Aplicações">
      <h2 className="side-title">Aplicações</h2>
      <ul>
        {queue.items.map((item) => {
          const at = blocking.indexOf(item)
          return (
            <Row
              key={item.id}
              item={item}
              project={projects.find((p) => p.id === item.projectId)?.name}
              line={statusLine(item, queue.running, blocking.slice(0, Math.max(at, 0)))}
            />
          )
        })}
      </ul>
    </section>
  )
}
