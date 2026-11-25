import { useEffect, useState } from 'react'
import type { TrustedDevice } from '../../../shared/remote/machine.ts'
import { lastSeenLabel, roleLabel } from '../machine-groups'
import { api } from '../api'

/** "Aparelhos pareados": who controls this machine and whom it controls. */
export function RemoteDevices() {
  const [devices, setDevices] = useState<TrustedDevice[]>([])
  useEffect(() => {
    let alive = true
    const load = () => void api.remote.devices().then((d) => alive && setDevices(d)).catch(() => {})
    load()
    const t = setInterval(load, 4000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const remove = async (pub: string) => {
    await api.remote.revoke(pub)
    setDevices((d) => d.filter((x) => x.pub !== pub))
  }

  return (
    <div className="rp-section">
      <h4>Aparelhos pareados</h4>
      {devices.length === 0 && <p className="rp-hint">Nenhum aparelho pareado.</p>}
      {devices.map((d) => (
        <div key={d.pub} className="rp-device">
          <div className="rp-device-main">
            <span className="rp-device-name">{d.name}</span>
            <span className="rp-device-sub">
              {roleLabel(d.role)} · {lastSeenLabel(d.lastSeen)}
            </span>
            <label className="rp-check" title="Disponível numa próxima fase">
              <input type="checkbox" checked={d.terminal} disabled />
              Terminal remoto (em breve)
            </label>
          </div>
          <button className="rp-link danger" onClick={() => void remove(d.pub)}>
            Remover
          </button>
        </div>
      ))}
    </div>
  )
}
