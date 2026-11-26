import type { Project } from '../types'

export interface Scope {
  global: boolean
  /** active only in these, when not global */
  only: string[]
  /** off in these, when global */
  except: string[]
}

interface Props {
  scope: Scope
  /** the projects with a folder on this machine */
  projects: Project[]
  onChange: (scope: Scope) => void
}

/** Where a connector is active: every project minus the exceptions, or only the checked ones. */
export function ScopeFields({ scope, projects, onChange }: Props) {
  const checked = (path: string) => (scope.global ? !scope.except.includes(path) : scope.only.includes(path))
  const toggle = (path: string, on: boolean) => {
    const edit = (list: string[], add: boolean) => (add ? [...list, path] : list.filter((x) => x !== path))
    onChange(scope.global ? { ...scope, except: edit(scope.except, !on) } : { ...scope, only: edit(scope.only, on) })
  }

  return (
    <fieldset className="conn-projects">
      <legend>Projetos</legend>
      <label>
        <input type="checkbox" checked={scope.global} onChange={(e) => onChange({ ...scope, global: e.target.checked })} />
        Ativo em todos os projetos (inclui os novos)
      </label>
      {projects.length > 0 && (
        <span className="conn-scope-hint">
          {scope.global ? 'Exceções: desmarque onde não vale' : 'Ativo só nestes projetos (marque ao menos um)'}
        </span>
      )}
      {projects.map((p) => (
        <label key={p.id}>
          <input type="checkbox" checked={checked(p.path as string)} onChange={(e) => toggle(p.path as string, e.target.checked)} />
          {p.name}
        </label>
      ))}
    </fieldset>
  )
}
