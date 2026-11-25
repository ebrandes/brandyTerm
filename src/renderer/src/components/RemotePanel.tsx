import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AppSettings } from '../../../shared/types.ts'
import type { MachineInfo } from '../../../shared/remote/machine.ts'
import { DEFAULT_REMOTE } from '../../../shared/remote/remote-settings.ts'
import { failedText, portFailed, type RemoteStatus } from '../../../shared/remote/status.ts'
import { RemotePairing } from './RemotePairing'
import { RemoteDevices } from './RemoteDevices'
import { api } from '../api'
import { report } from '../notice'
import './machine.css'

const TIP = 'Deixa seus outros computadores pareados verem e comandarem os projetos desta máquina. Só aceita aparelhos que você pareou'

function MachineName({ machine }: { machine?: MachineInfo }) {
  const [name, setName] = useState(machine?.name ?? '')
  useEffect(() => setName(machine?.name ?? ''), [machine?.name])
  const save = () => {
    const v = name.trim()
    if (v && v !== machine?.name) void api.remote.rename(v).catch((e) => {
      setName(machine?.name ?? '')
      report(e)
    })
    else setName(machine?.name ?? '')
  }
  return (
    <label className="rp-field">
      Nome desta máquina
      <input value={name} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} maxLength={60} />
    </label>
  )
}

/** What the server really does (the switch only says what was asked): asked again on a change and while on. */
function useRemoteStatus(enabled: boolean, port: number): RemoteStatus {
  const [status, setStatus] = useState<RemoteStatus>({ state: 'off' })
  useEffect(() => {
    let alive = true
    const load = () => void api.remote.status().then((s) => alive && setStatus(s)).catch(() => {})
    load()
    const t = enabled ? setInterval(load, 3000) : undefined
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [enabled, port])
  return status
}

/** Sidebar block "Acesso remoto": opens this machine to paired computers and manages the pairing. */
export function RemotePanel({ machine, settings }: { machine?: MachineInfo; settings?: AppSettings }) {
  const [open, setOpen] = useState(false)
  const remote = { ...DEFAULT_REMOTE, ...settings?.remote }
  const status = useRemoteStatus(remote.enabled, remote.port)
  const failed = remote.enabled && status.state === 'failed'
  const dot = failed ? 'dot-err' : remote.enabled && status.state === 'on' ? 'dot-ok' : 'dot-off'
  return (
    <div className="side-section">
      <button className="rp-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight size={13} className={`rp-chev${open ? ' open' : ''}`} />
        <h3>Acesso remoto</h3>
        <span className={`dot ${dot}`} title={failed ? portFailed(status.port) : undefined} />
      </button>
      {open && (
        <div className="rp-body">
          <label className="rp-row" title={TIP}>
            <span>Acesso remoto (rede local)</span>
            <input type="checkbox" checked={remote.enabled} onChange={(e) => void api.setSettings({ remote: { ...remote, enabled: e.target.checked } }).catch(report)} />
          </label>
          {failed && <p className="rp-error">{failedText(status.port, status.error)}</p>}
          <MachineName machine={machine} />
          <RemotePairing />
          <RemoteDevices />
        </div>
      )}
    </div>
  )
}
