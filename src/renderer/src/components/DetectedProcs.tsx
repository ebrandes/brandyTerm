import { ExternalLink } from 'lucide-react'
import { api } from '../api'
import { report } from '../notice'
import { procLabel, type DetectedProc, type ProcOrigin } from '../../../shared/proc-attribution.ts'

const ORIGIN: Record<ProcOrigin, { label: string; tip: string }> = {
  terminal: { label: 'terminal', tip: 'Iniciado no terminal integrado' },
  thread: { label: 'thread', tip: 'Iniciado por uma thread ou pelo coordenador' },
  external: { label: 'já rodando', tip: 'Rodando na pasta do projeto, fora do terminal e das threads ativas' }
}

/** Processes found on the system. Listed only: there is no way to stop them from here. */
export function DetectedProcs({ projectId, detected }: { projectId: string; detected: DetectedProc[] }) {
  return (
    <>
      {detected.map((x) => (
        <div key={x.pid} className="proc detected">
          <div className="proc-top">
            <span className="dot dot-ok" />
            <strong title={x.command}>{procLabel(x.command)}</strong>
            <span className="proc-state" title={`${ORIGIN[x.origin].tip} (pid ${x.pid})`}>
              {ORIGIN[x.origin].label} · {x.pid}
            </span>
          </div>
          {x.ports.length > 0 && (
            <div className="ports">
              {x.ports.map((port) => (
                <button key={port} className="port" onClick={() => void api.openPort(port, projectId).catch(report)} title={`Abrir http://localhost:${port}`}>
                  :{port} <ExternalLink size={11} />
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  )
}
