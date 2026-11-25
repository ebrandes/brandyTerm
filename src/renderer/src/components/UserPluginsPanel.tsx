import type { UserPlugin, UserPluginsState } from '../types'
import { api } from '../api'
import { plural } from '../side-summary'
import { SideSection } from './SideSection'
import './userplugins.css'

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
      <Toggle on={p.on} label={`Usar ${p.name} nas threads`} onChange={(on) => void api.setUserPlugin({ id: p.id, on })} />
    </div>
  )
}

/** Sidebar "Skills": which of the user's own Claude Code skills/plugins the threads may use. */
export function UserPluginsPanel({ state }: { state: UserPluginsState }) {
  const on = state.list.filter((p) => p.on).length + (state.personal?.on ? 1 : 0)
  const total = state.list.length + (state.personal ? 1 : 0)
  if (!total) return null
  return (
    <SideSection id="skills" title="Skills" summary={`${on}/${total} nas threads`}>
      {state.personal && (
        <div className="up-row" title="Suas skills e comandos de ~/.claude, como o plugin 'pessoal'">
          <span className="up-text">
            <span className="up-name">Suas skills</span>
            <span className="up-sub">{summary({ skills: state.personal.skills, commands: state.personal.commands, agents: 0 })}</span>
          </span>
          <Toggle on={state.personal.on} label="Usar suas skills nas threads" onChange={(v) => void api.setUserPlugin({ id: 'personal', on: v })} />
        </div>
      )}
      {state.list.map((p) => (
        <Row key={p.id} p={p} />
      ))}
      <p className="up-hint">Ligue o que as threads do Claude podem usar. MCPs e configurações globais ficam de fora.</p>
    </SideSection>
  )
}
