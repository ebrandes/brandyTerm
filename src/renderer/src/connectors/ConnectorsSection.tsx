import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type { ConnectorsState } from '../../../shared/connectors.ts'
import type { MachineInfo } from '../../../shared/remote/machine.ts'
import type { Project } from '../types'
import { dispose } from '../terminals'
import { useRemoteHosts } from '../useRemoteHosts'
import { AddConnectorDialog } from './AddConnectorDialog'
import { ConnectorRow } from './ConnectorRow'
import { ImportConnectors } from './ImportConnectors'
import { LoginCard } from './LoginCard'
import { onlyElsewhere } from './elsewhere'
import { goneTerminals } from './login-terminals'
import { statusClass } from './status'
import { useHostConnectors } from './useHostConnectors'
import './connectors.css'

interface Props {
  state?: ConnectorsState
  /** this machine's projects, for the "limited to" choice */
  projects: Project[]
  /** set when the project in view belongs to a paired machine: its connectors show, read-only */
  viewing?: MachineInfo
}

/** Sidebar "Conectores". Install, configure, login and remove exist only for this machine's own connectors. */
export function ConnectorsSection({ state, projects, viewing }: Props) {
  const [adding, setAdding] = useState<{ preset?: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const hosts = useHostConnectors(useRemoteHosts())
  // a login terminal lives until its login ends, not until its card unmounts
  const seen = useRef<string[]>([])
  useEffect(() => {
    const { gone, live } = goneTerminals(seen.current, state?.logins ?? [])
    for (const id of gone) dispose(id)
    seen.current = live
  }, [state?.logins])

  if (viewing) {
    const theirs = hosts.find((h) => h.machine.id === viewing.id)?.list ?? []
    return (
      <div className="side-section">
        <h3>Conectores · {viewing.name}</h3>
        {theirs.length === 0 && <p className="conn-hint">Nenhum conector instalado em {viewing.name}.</p>}
        {theirs.map((c) => (
          <div key={c.id} className="conn-row">
            <div className="conn-main">
              <span className="conn-name">{c.name}</span>
              <span className={`conn-chip ${statusClass(c.status)}`}>{c.status}</span>
              {c.toolCount !== undefined && <span className="conn-count">{c.toolCount} ferramentas</span>}
            </div>
          </div>
        ))}
        <p className="conn-hint">Instale, configure e remova pelo painel Conectores em {viewing.name}.</p>
      </div>
    )
  }

  const list = state?.list ?? []
  const elsewhere = onlyElsewhere(list, hosts)
  return (
    <div className="side-section">
      <h3>Conectores</h3>
      {list.length === 0 && <p className="conn-hint">Nenhum conector. Adicione um para os agentes usarem serviços externos.</p>}
      {(state?.logins ?? []).map((l) => <LoginCard key={l.connectorId} login={l} remote={false} />)}
      {list.map((c) => <ConnectorRow key={c.id} c={c} projects={projects} />)}
      {elsewhere.map((e) => (
        <div key={e.name} className="conn-else">
          <span className="conn-name">{e.name}</span>
          <span className="conn-count">Só em {e.machines.join(', ')}</span>
          {e.preset && <button onClick={() => setAdding({ preset: e.preset })}>Instalar aqui</button>}
        </div>
      ))}
      <div className="conn-foot">
        <button onClick={() => setAdding({})}><Plus size={12} /> Adicionar</button>
        <button onClick={() => setImporting(true)}>Importar do Claude Code</button>
      </div>
      {importing && <ImportConnectors onClose={() => setImporting(false)} />}
      {adding && <AddConnectorDialog initial={adding.preset} onClose={() => setAdding(null)} />}
    </div>
  )
}
