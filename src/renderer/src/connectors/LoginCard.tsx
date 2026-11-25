import { useEffect, useRef } from 'react'
import { ShieldQuestion } from 'lucide-react'
import type { PanelLogin, ThreadLogin } from '../../../shared/connectors.ts'
import { attach } from '../terminals'
import { api } from '../api'
import { report } from '../notice'
import { loginCardView } from './login-card-view'
import { loginTerminalOf } from './login-terminals'
import './login-card.css'

interface Props {
  login: ThreadLogin | PanelLogin
  machineName?: string
  /** the card belongs to a paired machine: login can only happen there */
  remote: boolean
  /** only the panel card shows the login terminal */
  place?: 'panel' | 'thread'
}

/** "Conectar <nome>": Entrar and Cancelar, the token fields or the login terminal. Same card in the panel and in a thread's chat. */
export function LoginCard({ login, machineName, remote, place = 'panel' }: Props) {
  const view = loginCardView(login, remote, machineName, place)
  const term = loginTerminalOf(login)
  const isCli = login.authKind === 'cli' && !remote && place === 'panel'
  const box = useRef<HTMLDivElement>(null)
  const fields = useRef<Record<string, HTMLInputElement | null>>({})

  // the terminal entry exists from the first paint, so the CLI's earliest output is kept
  useEffect(() => {
    if (!isCli) return
    attach(term) // never disposed here: ConnectorsSection forgets it when the login ends
  }, [isCli, term])

  useEffect(() => {
    const el = box.current
    if (!view.showTerminal || !el) return
    const e = attach(term)
    el.appendChild(e.host)
    try {
      e.fit.fit()
    } catch {
      // not laid out yet
    }
    e.term.focus()
    return () => { if (e.host.parentElement === el) e.host.remove() }
  }, [view.showTerminal, term])

  const enter = () => {
    // secrets are read from the inputs here and never kept in state
    const values: Record<string, string> = {}
    if (login.authKind === 'token') for (const f of login.fields ?? []) values[f.key] = fields.current[f.key]?.value ?? ''
    api.connectors.login({ id: login.connectorId, values }).catch(report)
  }

  return (
    <div className="attn login-card" role="group" aria-label={view.title}>
      <div className="attn-head"><ShieldQuestion size={15} /> {view.title}</div>
      {view.showFields && (login.fields ?? []).map((f) => (
        <label key={f.key} className="login-field">
          {f.label}
          <input type="password" autoComplete="off" ref={(el) => { fields.current[f.key] = el }} />
        </label>
      ))}
      {view.note && <p className={`attn-hint${login.phase === 'failed' ? ' login-error' : ''}`}>{view.note}</p>}
      {view.showTerminal && <div ref={box} className="login-term" />}
      <div className="attn-actions">
        {view.primary && <button className="primary" disabled={view.primary.disabled} onClick={enter}>{view.primary.label}</button>}
        {view.cancel && <button onClick={() => void api.connectors.loginCancel({ id: login.connectorId }).catch(report)}>Cancelar</button>}
      </div>
    </div>
  )
}
