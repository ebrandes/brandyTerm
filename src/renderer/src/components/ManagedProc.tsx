import { useEffect, useState } from 'react'
import { ExternalLink, Loader2, Play, Square, Trash2 } from 'lucide-react'
import { api } from '../api'
import { report } from '../notice'
import { parseId } from '../remote/route'
import { StopConfirm } from './StopConfirm'
import type { RunningProcess } from '../../../shared/proc-stop-labels.ts'

const REMOTE_PORT_TIP = 'Abre pela rede local; o servidor precisa escutar além de localhost'
/** past the scan, the grace period and the forced kill */
const GIVE_UP_MS = 20_000

type Phase = 'idle' | 'confirm' | 'stopping' | 'stuck'

/** A process the "+" button started. */
export function ManagedProc({ projectId, proc: x }: { projectId: string; proc: RunningProcess }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const remote = parseId(projectId).machineId !== null
  const running = x.state === 'running'
  const target = { projectId, processId: x.id }

  useEffect(() => {
    if (!running) setPhase('idle')
    if (phase !== 'stopping') return
    const timer = setTimeout(() => setPhase('stuck'), GIVE_UP_MS)
    return () => clearTimeout(timer)
  }, [phase, running])

  if (running && phase === 'confirm') {
    return (
      <StopConfirm
        name={x.name}
        pid={x.pid}
        ports={x.ports}
        remote={remote}
        onCancel={() => setPhase('idle')}
        onConfirm={() => {
          setPhase('stopping')
          void api.stopProcess(target)
        }}
      />
    )
  }

  return (
    <div className="proc">
      <div className="proc-top">
        <span className={`dot ${running ? 'dot-ok' : 'dot-off'}`} />
        <strong>{x.name}</strong>
        <span className="proc-state">{running ? 'rodando' : `saiu (${x.exitCode ?? '?'})`}</span>
        <span className="proc-actions">
          {running ? (
            <button className="icon-btn sm" aria-label="Parar" title="Parar" disabled={phase === 'stopping'} onClick={() => setPhase('confirm')}>
              <Square size={12} />
            </button>
          ) : (
            <>
              <button
                className="icon-btn sm"
                aria-label="Reiniciar"
                title="Iniciar de novo"
                onClick={() => {
                  void api.removeProcess(target)
                  void api.startProcess({ projectId, name: x.name, command: x.command })
                }}
              >
                <Play size={12} />
              </button>
              <button className="icon-btn sm" aria-label="Remover" title="Remover da lista" onClick={() => void api.removeProcess(target)}>
                <Trash2 size={12} />
              </button>
            </>
          )}
        </span>
      </div>
      <code className="proc-cmd">{x.command}</code>
      {running && phase === 'stopping' && (
        <p className="stop-status" role="status"><Loader2 size={12} className="spin" /> parando…</p>
      )}
      {running && phase === 'stuck' && (
        <p className="stop-status stop-error" role="alert">
          erro: o processo continua rodando (veja o log)
          <button onClick={() => setPhase('confirm')}>Tentar de novo</button>
        </p>
      )}
      {x.ports.length > 0 && (
        <div className="ports">
          {x.ports.map((port) => (
            <button key={port} className="port" onClick={() => void api.openPort(port, projectId).catch(report)} title={remote ? REMOTE_PORT_TIP : `Abrir http://localhost:${port}`}>
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
  )
}
