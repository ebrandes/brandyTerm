import { useEffect, useState } from 'react'
import type { TrustedDevice } from '../../../shared/remote/machine.ts'
import { lastSeenLabel, roleLabel } from '../machine-groups'
import { api } from '../api'
import { report } from '../notice'

/** "Aparelhos pareados": who controls this machine and whom it controls. */
export function RemoteDevices() {
  const [devices, setDevices] = useState<TrustedDevice[]>([])
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    const load = () =>
      void api.remote.devices().then((d) => {
        if (!alive) return
        setDevices(d)
        setFailed(false)
      }).catch(() => alive && setFailed(true))
    load()
    const t = setInterval(load, 4000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const remove = async ({ pub, role }: TrustedDevice) => {
    try {
      await api.remote.revoke({ pub, role })
      setDevices((d) => d.filter((x) => !(x.pub === pub && x.role === role)))
    } catch (e) {
      report(e)
    }
  }

  return (
    <div className="rp-section">
      <h4>Aparelhos pareados</h4>
      {failed && <p className="rp-error">Não foi possível ler os aparelhos pareados.</p>}
      {!failed && devices.length === 0 && <p className="rp-hint">Nenhum aparelho pareado.</p>}
      {devices.map((d) => (
        <div key={`${d.role}:${d.pub}`} className="rp-device">
          <div className="rp-device-main">
            <span className="rp-device-name">{d.name}</span>
            <span className="rp-device-sub">
              {roleLabel(d.role)} · {lastSeenLabel(d.lastSeen)}
            </span>
            {d.role === 'client' && (
              <label className="rp-check" title="Disponível numa próxima fase">
                <input type="checkbox" checked={d.terminal} disabled />
                Terminal remoto (em breve)
              </label>
            )}
          </div>
          <button className="rp-link danger" onClick={() => void remove(d)}>
            Remover
          </button>
        </div>
      ))}
    </div>
  )
}
