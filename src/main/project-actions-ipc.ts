import { existsSync } from 'node:fs'
import { shell } from 'electron'
import type { Engine } from './engine.ts'
import type { ActionResult } from '../shared/api.ts'
import type { Project } from '../shared/types.ts'
import { registry } from './rpc/registry.ts'
import { ruleOf } from './rpc/channels.ts'
import { killTerminal } from './terminal.ts'
import { forgetProjectSettings } from './settings.ts'
import {
  canRemove, clearCoordinatorContext, forgetProjectData, renameProject, setProjectArchived
} from './project-actions.ts'

/**
 * The sidebar's per-project menu. Every handler takes only the id of a project that exists in
 * the state and answers { ok, error }; the folder on disk is never written to or deleted.
 */

const CLEARED = 'Contexto do coordenador limpo. A próxima mensagem começa uma sessão nova com a memória do projeto.'
const MISSING: ActionResult = { ok: false, error: 'Projeto não encontrado.' }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

export function registerProjectActionsIpc(engine: Engine, archiveDir: string): void {
  const find = (id: unknown): Project | undefined =>
    typeof id === 'string' ? engine.state.projects.find((p) => p.id === id) : undefined
  const fromArg = (a: unknown): Project | undefined => (isObj(a) ? find(a.projectId) : undefined)
  const saved = (r: ActionResult): ActionResult => {
    if (r.ok) engine.touch()
    return r
  }

  registry.add('project:rename', (a: unknown): ActionResult => {
    const p = fromArg(a)
    return p ? saved(renameProject(p, (a as { name?: unknown }).name)) : MISSING
  }, ruleOf('project:rename'))

  registry.add('project:archive', (a: unknown): ActionResult => {
    const p = fromArg(a)
    return p ? saved(setProjectArchived(p, (a as { archived?: unknown }).archived === true)) : MISSING
  }, ruleOf('project:archive'))

  registry.add('project:clear-context', (a: unknown): ActionResult => {
    const p = fromArg(a)
    return p ? saved(clearCoordinatorContext(p, engine.msg('system', CLEARED))) : MISSING
  }, ruleOf('project:clear-context'))

  registry.add('project:reveal', async (a: unknown): Promise<ActionResult> => {
    const p = fromArg(a)
    if (!p) return MISSING
    if (!p.path || !existsSync(p.path)) return { ok: false, error: 'A pasta do projeto não existe mais neste caminho.' }
    const error = await shell.openPath(p.path)
    return error ? { ok: false, error } : { ok: true }
  }, ruleOf('project:reveal'))

  // leaves the app only: the folder stays; the app's own data about it (state, archive, lastSeen) goes
  registry.add('project:remove', (id: unknown): ActionResult => {
    const p = find(id)
    if (!p) return MISSING
    const allowed = canRemove(p)
    if (!allowed.ok) return allowed
    for (const proc of [...p.processes]) engine.removeProcess(p.id, proc.id)
    killTerminal(p.id)
    engine.removeProject(p.id)
    const lastSeen = forgetProjectData(archiveDir, engine.state.settings?.lastSeen, p.id)
    engine.state.settings = forgetProjectSettings(p.id, lastSeen)
    engine.touch()
    return { ok: true }
  }, ruleOf('project:remove'))
}
