import { useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import type { Project } from '../types'
import { api } from '../api'
import { ManagedProc } from './ManagedProc'
import { DetectedProcs } from './DetectedProcs'
import type { DetectedProc } from '../../../shared/proc-attribution.ts'

interface Props {
  project: Project
  /** running without the "+" button */
  detected: DetectedProc[]
  /** reads that list again, after a stop */
  refresh: () => void
  /** false: only the header line shows (the add form keeps its draft) */
  open: boolean
  /** the minimize/expand button, owned by OverviewDock */
  toggle: ReactNode
}

export function ProcessPanel({ project, detected, refresh, open, toggle }: Props) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const canStart = !project.demo && !!project.path

  const start = () => {
    if (!command.trim()) return
    void api.startProcess({ projectId: project.id, name, command })
    setName('')
    setCommand('')
    setAdding(false)
  }

  return (
    <section className={`procs${open ? '' : ' minimized'}`}>
      <div className="procs-head">
        <h3>{toggle}</h3>
        {open && canStart && (
          <button className="icon-btn" onClick={() => setAdding((v) => !v)} aria-label="Novo processo" title="Novo processo (ex.: npm run dev)">
            <Plus size={15} />
          </button>
        )}
      </div>

      <div id="dock-procs" hidden={!open}>
        {adding && (
          <form
            className="proc-form"
            onSubmit={(e) => {
              e.preventDefault()
              start()
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex.: frontend)" aria-label="Nome do processo" />
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="Comando (ex.: npm run dev)"
              aria-label="Comando"
              autoFocus
            />
            <div className="proc-form-actions">
              <button type="button" onClick={() => setAdding(false)}>Cancelar</button>
              <button type="submit" className="go" disabled={!command.trim()}>Iniciar</button>
            </div>
            <p className="hint">Roda na pasta do projeto, com as suas permissões. Encerra junto com o app.</p>
          </form>
        )}

        {project.processes.map((x) => (
          <ManagedProc key={x.id} projectId={project.id} proc={x} />
        ))}

        <DetectedProcs
          key={project.id}
          project={project}
          detected={detected}
          open={open}
          refresh={refresh}
          empty={project.processes.length === 0 && !adding && <p className="empty small">Servidores e comandos longos (frontend, backend…) aparecem aqui com as portas.</p>}
        />
      </div>
    </section>
  )
}
