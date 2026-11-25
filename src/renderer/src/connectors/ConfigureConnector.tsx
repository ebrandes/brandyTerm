import { useState } from 'react'
import type { ConnectorView } from '../../../shared/connectors.ts'
import type { Project } from '../types'
import { api } from '../api'
import { report } from '../notice'

interface Props {
  c: ConnectorView
  projects: Project[]
  onDone: () => void
}

/** Name, description, the projects it is limited to and replacement secret values (names only; values show as ••••). */
export function ConfigureConnector({ c, projects, onDone }: Props) {
  const [name, setName] = useState(c.name)
  const [description, setDescription] = useState(c.description)
  const [only, setOnly] = useState<string[]>(c.projects ?? [])
  const [env, setEnv] = useState<Record<string, string>>({})
  const [headers, setHeaders] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const local = projects.filter((p) => p.path && !p.machine?.remote)

  const save = async () => {
    setSaving(true)
    try {
      await api.connectors.update({ id: c.id, patch: { name, description, projects: only }, secrets: { env, headers } })
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
      {local.length > 0 && (
        <fieldset className="conn-projects">
          <legend>Limitar aos projetos (nenhum marcado: todos)</legend>
          {local.map((p) => (
            <label key={p.id}>
              <input type="checkbox" checked={only.includes(p.path as string)}
                onChange={(e) => setOnly(e.target.checked ? [...only, p.path as string] : only.filter((x) => x !== p.path))} />
              {p.name}
            </label>
          ))}
        </fieldset>
      )}
      {keys('e', c.envKeys, setEnv, env)}
      {keys('h', c.headerKeys, setHeaders, headers)}
      <div className="conn-actions">
        <button onClick={onDone}>Cancelar</button>
        <button className="primary-sm" onClick={() => void save()} disabled={saving || !name.trim()}>Salvar</button>
      </div>
    </div>
  )
}
