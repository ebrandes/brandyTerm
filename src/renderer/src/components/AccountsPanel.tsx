import { useState } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { AccountsState, ClaudeAccount, LimitWindow } from '../types'
import { AccountLogin } from './AccountLogin'
import { api } from '../api'
import { usageLine } from '../side-summary'
import './accounts.css'

const pct = (w?: LimitWindow) => (w ? Math.round(w.utilization * 100) : undefined)
const level = (p?: number) => (p === undefined ? 'unknown' : p >= 90 ? 'high' : p >= 70 ? 'mid' : 'low')

function resets(w?: LimitWindow): string {
  if (!w?.resetsAt) return ''
  const d = new Date(w.resetsAt * 1000)
  const hours = (d.getTime() - Date.now()) / 3600000
  if (hours <= 0) return 'renovando'
  if (hours < 24) return `renova ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
  return `renova ${d.toLocaleDateString('pt-BR', { weekday: 'short' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit' })}h`
}

/** Weekly usage ring, like Claude Code's status dot. */
export function UsageRing({ value, size = 22 }: { value?: number; size?: number }) {
  const r = size / 2 - 2.5
  const c = 2 * Math.PI * r
  const v = Math.min(100, value ?? 0)
  return (
    <svg className={`ring ${level(value)}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" />
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-fg" strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  )
}

function AccountRow({ a, active }: { a: ClaudeAccount; active: boolean }) {
  const [editing, setEditing] = useState(false)
  const week = pct(a.sevenDay)
  const five = pct(a.fiveHour)
  const limited = (a.limitedUntil ?? 0) > Date.now() / 1000
  const detail = a.error
    ? a.error
    : limited
      ? `no limite · ${resets(a.sevenDay?.utilization && a.sevenDay.utilization >= 1 ? a.sevenDay : a.fiveHour)}`
      : week === undefined
        ? a.checking
          ? 'lendo limites…'
          : 'limites ainda não lidos'
        : usageLine(five, week)
  const renew = !a.error && !limited && week !== undefined ? resets(a.sevenDay) : ''
  const detailTip = renew ? `5h ${five ?? 0}% · semana ${week}% · ${renew}` : detail
  return (
    <div className={`acct${active ? ' active' : ''}${limited || a.error ? ' blocked' : ''}`}>
      <button
        className="acct-main"
        onClick={() => !active && void api.accounts.activate(a.id)}
        onDoubleClick={() => setEditing(true)}
        title={active ? 'Conta em uso (duplo clique para renomear)' : 'Usar esta conta (duplo clique para renomear)'}
        aria-pressed={active}
      >
        <span className="acct-radio" />
        <span className="acct-text">
          {editing ? (
            <input
              className="acct-edit"
              defaultValue={a.label}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                void api.accounts.rename({ id: a.id, label: e.target.value })
                setEditing(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
          ) : (
            <span className="acct-name">
              <span>{a.label}</span>
              {a.plan && <span className="acct-plan">{a.plan}</span>}
            </span>
          )}
          <span className="acct-detail" title={detailTip}>
            {detail}
          </span>
          {week !== undefined && (
            <span className={`acct-bar ${level(week)}`}>
              <span style={{ width: `${Math.min(100, week)}%` }} />
            </span>
          )}
        </span>
        <span className="acct-ring" title={week === undefined ? 'Uso semanal desconhecido' : `Semana: ${week}% usado`}>
          <UsageRing value={week} />
          {week !== undefined && <span className="acct-pct">{week}</span>}
        </span>
      </button>
      <div className="acct-actions">
        <button onClick={() => void api.accounts.probe(a.id)} disabled={a.checking} title="Atualizar limites" aria-label="Atualizar limites">
          <RefreshCw size={12} className={a.checking ? 'spin' : ''} />
        </button>
        {a.kind === 'token' && (
          <button onClick={() => void api.accounts.remove(a.id)} title="Remover conta" aria-label={`Remover ${a.label}`}>
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

/** Sidebar block: Claude accounts with weekly usage, the active one, auto switch and add account. */
export function AccountsPanel({ state }: { state: AccountsState }) {
  const [adding, setAdding] = useState(false)
  return (
    <div className="side-section accounts">
      <div className="side-head acct-head">
        <h3 className="side-title">Contas Claude</h3>
        <button className="icon-btn sm" onClick={() => setAdding(true)} title="Adicionar conta" aria-label="Adicionar conta">
          <Plus size={14} />
        </button>
      </div>
      {state.list.map((a) => (
        <AccountRow key={a.id} a={a} active={a.id === state.activeId} />
      ))}
      <label className="acct-auto" title="Quando a conta em uso chega no limite (5h ou semanal), as próximas execuções vão para a outra conta">
        <input type="checkbox" checked={state.autoSwitch} onChange={(e) => void api.accounts.setAuto(e.target.checked)} />
        Trocar sozinho no limite
      </label>
      {state.lastSwitch && <p className="acct-switch">{state.lastSwitch}</p>}
      {(adding || state.login) && <AccountLogin login={state.login} count={state.list.length} onClose={() => setAdding(false)} />}
    </div>
  )
}
