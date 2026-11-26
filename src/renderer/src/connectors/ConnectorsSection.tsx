import { useEffect, useRef, useState } from 'react'
import { Download, FileText, Plus } from 'lucide-react'
import { api } from '../api'
import type { ConnectorsState } from '../../../shared/connectors.ts'
import { connectorDot, type DotProject } from '../../../shared/connector-dot.ts'
import type { MachineInfo } from '../../../shared/remote/machine.ts'
import type { Project } from '../types'
import { dispose } from '../terminals'
import { useRemoteHosts } from '../useRemoteHosts'
import { SideSection } from '../components/SideSection'
import { AddConnectorDialog } from './AddConnectorDialog'
import { ConnectorRow } from './ConnectorRow'
import { ImportConnectors } from './ImportConnectors'
import { LoginCard } from './LoginCard'
import { LogsModal } from './LogsModal'
import { onlyElsewhere } from './elsewhere'
import { goneTerminals } from './login-terminals'
import { useHostConnectors } from './useHostConnectors'
import './connectors.css'

interface Props {
  state?: ConnectorsState
  /** this machine's projects, for the "limited to" choice */
  projects: Project[]
  /** set when the project in view belongs to a paired machine: its connectors also show, read-only */
  viewing?: MachineInfo
  /** the selected project: each dot says whether its connector is on there, and changes with it */
  active?: Project
}

/** Sidebar "Conectores". Install, configure, login and remove exist only for this machine's own connectors. */
export function ConnectorsSection({ state, projects, viewing, active }: Props) {
  const [adding, setAdding] = useState<{ preset?: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const [logs, setLogs] = useState(false)
  const hosts = useHostConnectors(useRemoteHosts())
  // a login terminal lives until its login ends, not until its card unmounts
  const seen = useRef<string[]>([])
  useEffect(() => {
    const { gone, live } = goneTerminals(seen.current, state?.logins ?? [])
    for (const id of gone) dispose(id)
    seen.current = live
  }, [state?.logins])

  const list = state?.list ?? []
  const elsewhere = onlyElsewhere(list, hosts)
  const theirs = viewing ? hosts.find((h) => h.machine.id === viewing.id)?.list ?? [] : []
  const logins = state?.logins ?? []
  // this machine's connectors are never used by a project that runs on a paired machine
  const here: DotProject | undefined = active && { name: active.name, path: active.path, elsewhere: viewing?.name }
  const there: DotProject | undefined = active && { name: active.name, path: active.path }
  const actions = (
    <>
      <button className="icon-btn" onClick={() => setAdding({})} aria-label="Adicionar conector" title="Adicionar">
        <Plus size={14} />
      </button>
      <button className="icon-btn" onClick={() => setImporting(true)} aria-label="Importar do Claude Code" title="Importar do Claude Code">
        <Download size={13} />
      </button>
      <button className="icon-btn" onClick={() => setLogs(true)} aria-label="Ver logs" title="Ver logs de diagnóstico">
        <FileText size={13} />
      </button>
    </>
  )
  return (
    <>
      <SideSection id="connectors" title="Conectores" summary={list.length} actions={actions} forceOpen={logins.length > 0}>
        {state?.fault && <p className="conn-error" role="alert">{state.fault}</p>}
        {list.length === 0 && !state?.fault && <p className="conn-hint">Nenhum conector.</p>}
        {logins.map((l) => <LoginCard key={l.connectorId} login={l} remote={false} />)}
        {list.map((c) => <ConnectorRow key={c.id} c={c} projects={projects} here={here} />)}
        {elsewhere.map((e) => (
          <div key={e.name} className="conn-else">
            <span className="conn-name">{e.name}</span>
            <span className="conn-count">Só em {e.machines.join(', ')}</span>
            {e.preset && <button onClick={() => setAdding({ preset: e.preset })}>Instalar aqui</button>}
          </div>
        ))}
        {viewing && (
          <div className="conn-remote">
            <h4>Em {viewing.name}</h4>
            {theirs.length === 0 && <p className="conn-hint">Nenhum conector instalado em {viewing.name}.</p>}
            {theirs.map((c) => {
              const dot = connectorDot(c, there)
              return (
                <div key={c.id} className="conn-row">
                  <div className="conn-main">
                    <span className={`dot conn-dot ${dot.tone}`} role="img" aria-label={dot.label} title={dot.label} />
                    <span className="conn-name" title={c.name}>{c.name}</span>
                    {c.toolCount !== undefined && <span className="conn-count">{c.toolCount} ferramentas</span>}
                  </div>
                </div>
              )
            })}
            <p className="conn-hint">Threads deste projeto rodam em {viewing.name} e usam os conectores de lá.</p>
          </div>
        )}
      </SideSection>
      {logs && <LogsModal area="mcp" onClose={() => setLogs(false)} />}
      {importing && <ImportConnectors onClose={() => setImporting(false)} />}
      {adding && <AddConnectorDialog initial={adding.preset} onClose={() => setAdding(null)} />}
    </>
  )
}
