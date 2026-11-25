import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { UserPlugin, UserPluginsState } from '../types'
import './userplugins.css'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function summary(p: Pick<UserPlugin, 'skills' | 'commands' | 'agents'>): string {
  const parts = [p.skills && plural(p.skills, 'skill', 'skills'), p.commands && plural(p.commands, 'comando', 'comandos'), p.agents && plural(p.agents, 'agente', 'agentes')]
  return parts.filter(Boolean).join(' · ') || 'sem skills'
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button className={`up-toggle${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
      <span />
    </button>
  )
}

function Row({ p }: { p: UserPlugin }) {
  const tip = [
    p.description,
    p.hooks && 'Tem hooks: rodam em toda thread e podem mudar o estilo das respostas.',
    p.mcp && 'O MCP deste plugin não é carregado nas threads.',
    p.scope === 'project' && `Instalado só para o projeto ${p.project}: vale apenas nas threads dele.`
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <div className="up-row" title={tip}>
      <span className="up-text">
        <span className="up-name">
          {p.name}
          {p.scope === 'project' && <span className="up-tag">{p.project}</span>}
          {p.hooks && <span className="up-tag warn">hooks</span>}
        </span>
        <span className="up-sub">{summary(p)}</span>
      </span>
      <Toggle on={p.on} label={`Usar ${p.name} nas threads`} onChange={(on) => void window.brandy.setUserPlugin({ id: p.id, on })} />
    </div>
  )
}

/** Sidebar block: which of the user's own Claude Code skills/plugins the threads may use. */
export function UserPluginsPanel({ state }: { state: UserPluginsState }) {
  const [open, setOpen] = useState(false)
  const on = state.list.filter((p) => p.on).length + (state.personal?.on ? 1 : 0)
  const total = state.list.length + (state.personal ? 1 : 0)
  if (!total) return null
  return (
    <div className="side-section">
      <button className="up-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <h3>Do seu Claude Code</h3>
        <span className="up-count">
          {on}/{total} nas threads
        </span>
        <ChevronRight size={13} className={open ? 'up-chev open' : 'up-chev'} />
      </button>
      {state.personal && (
        <div className="up-row" title="Suas skills e comandos de ~/.claude, como o plugin 'pessoal'">
          <span className="up-text">
            <span className="up-name">Suas skills</span>
            <span className="up-sub">{summary({ skills: state.personal.skills, commands: state.personal.commands, agents: 0 })}</span>
          </span>
          <Toggle on={state.personal.on} label="Usar suas skills nas threads" onChange={(v) => void window.brandy.setUserPlugin({ id: 'personal', on: v })} />
        </div>
      )}
      {open && (
        <>
          {state.list.map((p) => (
            <Row key={p.id} p={p} />
          ))}
          <p className="up-hint">Ligue o que as threads do Claude podem usar. MCPs e configurações globais ficam de fora.</p>
        </>
      )}
    </div>
  )
}
