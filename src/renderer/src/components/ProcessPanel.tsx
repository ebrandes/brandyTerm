import { useState } from 'react'
import { ExternalLink, Play, Plus, Square, Trash2 } from 'lucide-react'
import type { Project } from '../types'
import { api } from '../api'
import { parseId } from '../remote/route'

const REMOTE_PORT_TIP = 'Abre pela rede local; o servidor precisa escutar além de localhost'

export function ProcessPanel({ project }: { project: Project }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const remote = parseId(project.id).machineId !== null
  const canStart = !project.demo && !!project.path

  const start = () => {
    if (!command.trim()) return
    void api.startProcess({ projectId: project.id, name, command })
    setName('')
    setCommand('')
    setAdding(false)
  }

  return (
    <section className="procs">
      <div className="procs-head">
        <h3>Processos</h3>
        {canStart && (
          <button className="icon-btn" onClick={() => setAdding((v) => !v)} aria-label="Novo processo" title="Novo processo (ex.: npm run dev)">
            <Plus size={15} />
          </button>
        )}
      </div>

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

      {project.processes.length === 0 && !adding && <p className="empty small">Servidores e comandos longos (frontend, backend…) aparecem aqui com as portas.</p>}

      {project.processes.map((x) => (
        <div key={x.id} className="proc">
          <div className="proc-top">
            <span className={`dot ${x.state === 'running' ? 'dot-ok' : 'dot-off'}`} />
            <strong>{x.name}</strong>
            <span className="proc-state">{x.state === 'running' ? 'rodando' : `saiu (${x.exitCode ?? '?'})`}</span>
            <span className="proc-actions">
              {x.state === 'running' ? (
                <button className="icon-btn sm" aria-label="Parar" title="Parar" onClick={() => void api.stopProcess({ projectId: project.id, processId: x.id })}>
                  <Square size={12} />
                </button>
              ) : (
                <>
                  <button
                    className="icon-btn sm"
                    aria-label="Reiniciar"
                    title="Iniciar de novo"
                    onClick={() => {
                      void api.removeProcess({ projectId: project.id, processId: x.id })
                      void api.startProcess({ projectId: project.id, name: x.name, command: x.command })
                    }}
                  >
                    <Play size={12} />
                  </button>
                  <button className="icon-btn sm" aria-label="Remover" title="Remover da lista" onClick={() => void api.removeProcess({ projectId: project.id, processId: x.id })}>
                    <Trash2 size={12} />
                  </button>
                </>
              )}
            </span>
          </div>
          <code className="proc-cmd">{x.command}</code>
          {x.ports.length > 0 && (
            <div className="ports">
              {x.ports.map((port) => (
                <button key={port} className="port" onClick={() => void api.openPort(port, project.id).catch(() => {})} title={remote ? REMOTE_PORT_TIP : `Abrir http://localhost:${port}`}>
                  :{port} <ExternalLink size={11} />
                </button>
              ))}
            </div>
          )}
          {x.log.length > 0 && (
            <details className="proc-log">
              <summary>log ({x.log.length})</summary>
              <pre>{x.log.slice(-60).join('\n')}</pre>
            </details>
          )}
        </div>
      ))}
    </section>
  )
}
