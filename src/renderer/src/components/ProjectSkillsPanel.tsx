import { useState } from 'react'
import type { ProjectSkillsView } from '../types'
import { api } from '../api'
import { skillsSummary, viewPlugins } from '../plugin-list'
import { SideSection } from './SideSection'
import { SkillRowView } from './SkillRowView'
import { SkillsLibraryFooter } from './SkillsLibraryFooter'
import './userplugins.css'

interface Props {
  view: ProjectSkillsView
  projectId: string
  projectName: string
  /** the library repo, `dono/repo` or a URL */
  library: string
}

/** Sidebar "Skills" of the selected project: each switch changes only this project's list. */
export function ProjectSkillsPanel({ view, projectId, projectName, library }: Props) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string>()
  const shown = viewPlugins(view.rows, query, expanded)
  const run = async (call: () => Promise<{ ok: boolean; erro?: string }>) => {
    setBusy(true)
    setErro(undefined)
    try {
      const r = await call()
      if (!r.ok) setErro(r.erro ?? 'Não deu certo.')
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <SideSection id="skills" title={`Skills · ${projectName}`} summary={skillsSummary(view)}>
      {view.erro && <p className="up-hint warn">Lista inválida ({view.erro}): as threads usam o conjunto de antes até o arquivo ser corrigido.</p>}
      {!view.hasList && !view.erro && <p className="up-hint">Projeto sem lista: a primeira mudança cria .brandyterm/skills.json. Ou rode /skill-init.</p>}
      {view.aviso && <p className="up-hint warn">⚠ {view.aviso}</p>}
      {shown.searchable && (
        <input className="up-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar skill ou plugin…" aria-label="Buscar skill ou plugin" />
      )}
      {shown.rows.map((r) => (
        <SkillRowView key={r.id} row={r} busy={busy} onToggle={(v) => void run(() => api.toggleSkill({ projectId, id: r.id, on: v }))} />
      ))}
      {shown.searchable && !shown.matches && <p className="up-hint">Nada encontrado.</p>}
      {shown.canExpand && (
        <button className="up-more" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? 'Mostrar menos' : `Mostrar todos (${shown.matches})`}
        </button>
      )}
      {view.missing.length > 0 && (
        <div className="up-missing">
          <span title={view.missing.join(', ')}>⚠ falta instalar: {view.missing.join(', ')}</span>
          <button disabled={busy} onClick={() => void run(() => api.installMissingSkills({ projectId }))}>
            {busy ? 'Instalando…' : 'Instalar'}
          </button>
        </div>
      )}
      {erro && <p className="up-hint warn">{erro}</p>}
      <p className="up-hint">Vale a partir da próxima thread do projeto.</p>
      <SkillsLibraryFooter repo={library} />
    </SideSection>
  )
}
