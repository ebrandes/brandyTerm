import { useEffect, useRef, useState } from 'react'
import type { DiscoveredHost } from '../../../shared/remote/machine.ts'
import { OsIcon } from './MachineChip'
import { PAIRING_SECONDS, clock, secondsLeft } from '../machine-groups'
import { api } from '../api'
import { errorText } from '../notice'

/** what pairing gives away, shown wherever a code is shown or typed */
const PAIR_WARNING =
  'O aparelho pareado pode mandar mensagens, rodar comandos e ler arquivos dos projetos visíveis desta máquina. Pareie só computadores seus.'

function PairWarning() {
  return <p className="rp-warn" role="note">{PAIR_WARNING}</p>
}

/** This machine's pairing code (2 minutes), closed when it runs out or the panel goes away. */
function NewPairing() {
  const [code, setCode] = useState<string>()
  const [left, setLeft] = useState(0)
  const [error, setError] = useState<string>()
  const open = useRef(false)

  const close = () => {
    if (!open.current) return
    open.current = false
    void api.remote.closePairing().catch(() => {})
  }
  useEffect(() => close, [])
  useEffect(() => {
    if (!code) return
    const expiresAt = Date.now() + PAIRING_SECONDS * 1000
    const tick = () => {
      const s = secondsLeft(expiresAt, Date.now())
      setLeft(s)
      if (s === 0) {
        close()
        setCode(undefined)
      }
    }
    tick()
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
  }, [code])

  const start = async () => {
    setError(undefined)
    try {
      const c = await api.remote.openPairing()
      open.current = true
      setCode(c)
    } catch (e) {
      setError(errorText(e))
    }
  }
  const cancel = () => {
    close()
    setCode(undefined)
  }

  return (
    <div className="rp-section">
      {code ? (
        <div className="rp-code-box">
          <div className="rp-code" aria-label="Código de pareamento">
            {code.split('-').map((g, i) => <span key={i}>{g}</span>)}
          </div>
          <p className="rp-hint">Digite este código no outro computador</p>
          <PairWarning />
          <div className="rp-code-foot">
            <span className="rp-count">{clock(left)}</span>
            <button className="rp-link" onClick={cancel}>Cancelar</button>
          </div>
        </div>
      ) : (
        <button className="rp-btn" onClick={() => void start()}>Parear novo aparelho</button>
      )}
      {error && <p className="rp-error">{error}</p>}
    </div>
  )
}

function Discovered({ h }: { h: DiscoveredHost }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const pair = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await api.remote.pair({ address: h.address, code: code.trim() })
      setCode('')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="rp-found" onSubmit={(e) => { e.preventDefault(); if (code.trim() && !busy) void pair() }}>
      <span className="rp-found-name"><OsIcon os={h.os} /> {h.name}</span>
      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código" aria-label={`Código de ${h.name}`} autoCapitalize="characters" spellCheck={false} autoComplete="off" maxLength={19} />
      <button type="submit" className="rp-btn sm" disabled={busy || !code.trim()}>Parear</button>
      {code.trim() && <PairWarning />}
      {error && <p className="rp-error">{error}</p>}
    </form>
  )
}

/** Pairing both ways: this machine's code, and the computers on the network that are waiting for one. */
export function RemotePairing() {
  const [found, setFound] = useState<DiscoveredHost[]>([])
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    // mDNS runs only while this list is open (the polling below keeps it alive; the main stops it if it stops)
    void api.remote.discover(true).catch(() => alive && setFailed(true))
    const load = () =>
      void api.remote.discovered().then((d) => {
        if (!alive) return
        setFound(d)
        setFailed(false)
      }).catch(() => alive && setFailed(true))
    load()
    const t = setInterval(load, 3000)
    return () => {
      alive = false
      clearInterval(t)
      void api.remote.discover(false).catch(() => {})
    }
  }, [])
  return (
    <>
      <p className="rp-hint">
        O pareamento vale numa direção: cada computador pareia com o outro para poder comandá-lo. Para comandar nos dois sentidos, pareie em cada máquina.
      </p>
      <NewPairing />
      <div className="rp-section">
        <h4>Computadores na rede</h4>
        {failed && <p className="rp-error">Não foi possível procurar computadores na rede.</p>}
        {!failed && found.length === 0 && <p className="rp-hint">Nenhum computador encontrado.</p>}
        {found.map((h) => <Discovered key={h.machineId} h={h} />)}
      </div>
    </>
  )
}
