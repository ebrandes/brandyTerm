import { useState } from 'react'
import type { ConnectorView } from '../../../shared/connectors.ts'
import { isGlobal } from '../../../shared/connector-scope.ts'
import { ScopeFields, type Scope } from './ScopeFields'
import type { Project } from '../types'
import { api } from '../api'
import { report } from '../notice'

interface Props {
  c: ConnectorView
  projects: Project[]
  onDone: () => void
}

/** Name, description, the projects it is active in and replacement secret values (names only; values show as ••••). */
export function ConfigureConnector({ c, projects, onDone }: Props) {
  const [name, setName] = useState(c.name)
  const [description, setDescription] = useState(c.description)
  const [scope, setScope] = useState<Scope>({ global: isGlobal(c), only: c.projects ?? [], except: c.exceptProjects ?? [] })
  const [env, setEnv] = useState<Record<string, string>>({})
  const [headers, setHeaders] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const local = projects.filter((p) => p.path && !p.machine?.remote)
  // an empty list means every project, so "only these" needs at least one
  const nowhere = !scope.global && scope.only.length === 0

  const save = async () => {
    setSaving(true)
    try {
      const lists = scope.global ? { projects: [], exceptProjects: scope.except } : { projects: scope.only, exceptProjects: [] }
      await api.connectors.update({ id: c.id, patch: { name, description, ...lists }, secrets: { env, headers } })
      onDone()
    } catch (e) {
      report(e)
    } finally {
      setSaving(false)
    }
  }

  const keys = (label: string, list: string[] | undefined, set: (r: Record<string, string>) => void, cur: Record<string, string>) =>
    list?.map((k) => (
      <label key={`${label}${k}`} className="conn-field">
        {k}
        <input type="password" placeholder="••••" value={cur[k] ?? ''} autoComplete="off"
          onChange={(e) => set({ ...cur, [k]: e.target.value })} aria-label={`Novo valor de ${k}`} />
      </label>
    ))

  return (
    <div className="conn-config">
      <label className="conn-field">Nome<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="conn-field">Descrição<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <ScopeFields scope={scope} projects={local} onChange={setScope} />
      {keys('e', c.envKeys, setEnv, env)}
      {keys('h', c.headerKeys, setHeaders, headers)}
      <div className="conn-actions">
        <button onClick={onDone}>Cancelar</button>
        <button className="primary-sm" onClick={() => void save()} disabled={saving || !name.trim() || nowhere}>Salvar</button>
      </div>
    </div>
  )
}
