import { useEffect, useState } from 'react'
import type { Project } from '../types'
import type { ActionResult } from '../../../shared/api.ts'
import { busyReason } from '../../../shared/project-busy.ts'
import { report, showNotice } from '../notice'
import { api } from '../api'
import type { ProjectAsk } from './ProjectRow'

interface Props {
  ask: { kind: ProjectAsk; project: Project } | null
  onClose: () => void
}

/** the confirmations of the project menu: clear the coordinator's context, remove from the app */
export function ProjectDialogs({ ask, onClose }: Props) {
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (!ask) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [ask, onClose])

  if (!ask) return null
  const p = ask.project
  // live: a thread may start while the dialog is open
  const busy = busyReason(p)

  const confirm = (run: () => Promise<ActionResult>) => {
    setWorking(true)
    void run()
      .then((r) => {
        if (r && !r.ok) showNotice(r.error ?? 'Não deu para concluir a ação.')
      }, report)
      .finally(() => {
        setWorking(false)
        onClose()
      })
  }

  if (ask.kind === 'clear') {
    return (
      <div className="modal-back" role="dialog" aria-modal="true" aria-label="Limpar contexto do coordenador">
        <div className="modal">
          <h3>Limpar o contexto do coordenador de “{p.name}”?</h3>
          <p>A próxima mensagem começa uma sessão nova do coordenador e o contador de contexto volta a zero.</p>
          <p>Continuam: a memória do projeto (<code>.brandyterm/memoria.md</code>), as threads e o histórico da conversa.</p>
          {busy && <p className="modal-warn">{busy}</p>}
          <div className="modal-actions">
            <button onClick={onClose} autoFocus>Cancelar</button>
            <button
              className="primary"
              disabled={!!busy || working}
              onClick={() => confirm(() => api.clearCoordinatorContext({ projectId: p.id }))}
            >
              Limpar contexto
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Remover projeto do BrandyTerm">
      <div className="modal">
        <h3>Remover “{p.name}” do BrandyTerm?</h3>
        <p><strong>A pasta no disco não será apagada nem alterada</strong>{p.path ? <> (<code>{p.path}</code>)</> : null}: o projeto só sai do BrandyTerm.</p>
        <p>O que o app guardou dele vai embora: conversa, threads, threads arquivadas e o registro de última visita.</p>
        {p.machine?.remote && <p>Este projeto fica em {p.machine.name}: ele será removido de lá também.</p>}
        {busy && <p className="modal-warn">{busy}</p>}
        <div className="modal-actions">
          <button onClick={onClose} autoFocus>Cancelar</button>
          <button className="danger" disabled={!!busy || working} onClick={() => confirm(() => api.removeProject(p.id))}>
            Remover
          </button>
        </div>
      </div>
    </div>
  )
}
