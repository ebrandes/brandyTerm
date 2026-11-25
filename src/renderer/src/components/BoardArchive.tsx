import { useEffect, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import type { ArchivedThreadInfo, ThreadState } from '../types'
import { ago } from './BoardDetail'

const STATE_LABEL: Partial<Record<ThreadState, string>> = {
  done: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
  interrupted: 'Interrompida'
}

interface Props {
  projectIds: string[]
  showProject: boolean
  now: number
  onClose: () => void
  /** called after the thread is back in the state */
  onReopened: (threadId: string) => void
}

/** Side panel of the board: the archived threads, read from disk only while it is open. */
export function BoardArchive({ projectIds, showProject, now, onClose, onReopened }: Props) {
  const [list, setList] = useState<ArchivedThreadInfo[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const ids = projectIds.join(',')
  useEffect(() => {
    let live = true
    setList(null)
    void window.brandy.listArchived(ids ? ids.split(',') : []).then((l) => live && setList(l))
    return () => {
      live = false
    }
  }, [ids])

  const reopen = async (a: ArchivedThreadInfo) => {
    setBusy(a.id)
    const ok = await window.brandy.reopenArchived({ projectId: a.projectId, threadId: a.id })
    setBusy(null)
    if (ok) onReopened(a.id)
  }

  return (
    <aside className="board-detail" aria-label="Threads arquivadas">
      <header>
        <div>
          <h3>Arquivadas</h3>
          <p className="muted">Finalizadas há mais de 7 dias ou além das 50 mais recentes do projeto. Reabrir traz a thread de volta ao quadro.</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar arquivadas">
          <X size={14} />
        </button>
      </header>
      {!list && <p className="muted">Carregando…</p>}
      {list && list.length === 0 && <p className="muted">Nenhuma thread arquivada.</p>}
      {list && list.length > 0 && (
        <ul className="board-archive">
          {list.map((a) => (
            <li key={a.id}>
              {showProject && <span className="board-project">{a.projectName}</span>}
              <strong>{a.title}</strong>
              <span className="board-age">
                {STATE_LABEL[a.state] ?? a.state} · {ago(a.updatedAt, now)}
              </span>
              {(a.summary || a.note) && <span className="board-note">{a.summary ?? a.note}</span>}
              <button onClick={() => void reopen(a)} disabled={busy === a.id}>
                <RotateCcw size={12} /> {busy === a.id ? 'Reabrindo…' : 'Reabrir'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
