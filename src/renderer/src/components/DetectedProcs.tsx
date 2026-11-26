import { useEffect, useState, type ReactNode } from 'react'
import { ExternalLink, Loader2, Square } from 'lucide-react'
import type { Project } from '../types'
import { api } from '../api'
import { report } from '../notice'
import { useStopDetected, type Stop } from '../useStopDetected'
import { StopConfirm } from './StopConfirm'
import type { DetectedProc, ProcOrigin } from '../../../shared/proc-attribution.ts'
import { procKind, uptimeLabel } from '../../../shared/proc-kind.ts'
import './detected-procs.css'

const ORIGIN: Record<ProcOrigin, { label: string; tip: string }> = {
  terminal: { label: 'terminal', tip: 'Iniciado no terminal integrado' },
  thread: { label: 'thread', tip: 'Iniciado por uma thread ou pelo coordenador' },
  external: { label: 'já rodando', tip: 'Rodando na pasta do projeto, fora do terminal e das threads ativas' }
}

/** the uptime moves by the minute, and only while someone can see it */
function useClock(running: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [running])
  return now
}

interface CardProps {
  project: Project
  proc: DetectedProc
  stop: Stop | undefined
  /** no longer in the list: only the outcome is left to show */
  gone: boolean
  now: number
  onAsk: () => void
  onDismiss: () => void
}

function Card({ project, proc: x, stop, gone, now, onAsk, onDismiss }: CardProps) {
  const name = procKind(x.command)
  const place = x.folder ? x.folder : x.folder === '' ? project.name : x.cwd ?? project.name
  const uptime = uptimeLabel(x.startedAt, now)
  const busy = stop?.phase === 'stopping' || stop?.phase === 'stopped'
  return (
    <div className="proc detected">
      <div className="proc-top">
        <span className={`dot ${stop?.phase === 'stopped' ? 'dot-off' : 'dot-ok'}`} />
        <strong title={x.command}>{name}</strong>
        <span className="proc-state" title={`${ORIGIN[x.origin].tip} (pid ${x.pid})`}>
          {ORIGIN[x.origin].label} · {x.pid}
        </span>
        <button className="icon-btn sm" aria-label={`Parar ${name}`} title="Parar" disabled={busy || gone} onClick={onAsk}>
          <Square size={12} />
        </button>
      </div>
      <div className="proc-meta">
        <span className="proc-place" title={x.cwd}>{place}</span>
        {uptime && <span className="proc-uptime">{uptime}</span>}
      </div>
      <details className="proc-full">
        <summary title={x.command}>comando</summary>
        <code>{x.command}</code>
      </details>
      {stop?.phase === 'stopping' && (
        <p className="stop-status" role="status"><Loader2 size={12} className="spin" /> parando…</p>
      )}
      {stop?.phase === 'stopped' && <p className="stop-status stop-done" role="status">parado ✓</p>}
      {stop?.phase === 'error' && (
        <p className="stop-status stop-error" role="alert">
          erro: {stop.error}
          {gone ? <button onClick={onDismiss}>Fechar</button> : <button onClick={onAsk}>Tentar de novo</button>}
        </p>
      )}
      {!gone && x.ports.length > 0 && (
        <div className="ports">
          {x.ports.map((port) => (
            <button key={port} className="port" onClick={() => void api.openPort(port, project.id).catch(report)} title={`Abrir http://localhost:${port}`}>
              :{port} <ExternalLink size={11} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  project: Project
  detected: DetectedProc[]
  open: boolean
  refresh: () => void
  /** what to say when there is nothing at all to show */
  empty: ReactNode
}

/** Processes found on the system, each one stoppable after a confirmation. */
export function DetectedProcs({ project, detected, open, refresh, empty }: Props) {
  const now = useClock(open)
  const { rows, ask, cancel, confirm } = useStopDetected(project.id, detected, refresh)
  if (!rows.length) return <>{empty}</>
  return (
    <>
      {rows.map(({ proc, stop, gone }) =>
        stop?.phase === 'confirm' ? (
          <StopConfirm key={proc.pid} name={procKind(proc.command)} pid={proc.pid} ports={proc.ports} onCancel={() => cancel(proc.pid)} onConfirm={() => void confirm(proc)} />
        ) : (
          <Card key={proc.pid} project={project} proc={proc} stop={stop} gone={gone} now={now} onAsk={() => ask(proc)} onDismiss={() => cancel(proc.pid)} />
        )
      )}
    </>
  )
}
