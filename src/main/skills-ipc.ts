// The skills panel's channels: the per-project switch, "Instalar" and the library repo.
import type { Engine } from './engine.ts'
import { diagLog } from './diag-log.ts'
import { ruleOf } from './rpc/channels.ts'
import { registry } from './rpc/registry.ts'
import { setSkillsLibrary } from './settings.ts'
import { libraryUrl, switchLibrary } from './skills/library.ts'
import { installMissing, toggle } from './skills/view.ts'
import { paths, refreshSkills, syncNow, toggleDeps } from './skills/wiring.ts'

type Result = { ok: boolean; erro?: string }

const NO_FOLDER: Result = { ok: false, erro: 'Esse projeto não tem pasta.' }

export function registerSkillsIpc(engine: Engine, pushState: () => void): void {
  const folder = (id: unknown) => engine.state.projects.find((p) => p.id === String(id) && p.path)
  const done = (r: Result, projectId?: string): Result => {
    refreshSkills(engine, projectId)
    pushState()
    return r
  }
  registry.add('skills:toggle', async (a: { projectId: string; id: string; on: boolean }) => {
    const p = folder(a?.projectId)
    if (!p?.path) return NO_FOLDER
    return done(await toggle(p.path, String(a.id), !!a.on, toggleDeps(engine, p.path)), p.id)
  }, ruleOf('skills:toggle'))
  registry.add('skills:installMissing', async (a: { projectId: string }) => {
    const p = folder(a?.projectId)
    const view = p && engine.state.projectSkills?.[p.id]
    if (!p?.path || !view) return NO_FOLDER
    return done(await installMissing(view, { ...toggleDeps(engine, p.path), syncLibrary: syncNow }))
  }, ruleOf('skills:installMissing'))
  registry.add('skills:setLibrary', (a: { repo: string }) => {
    const repo = String(a?.repo ?? '').trim()
    let url: string
    try {
      url = libraryUrl(repo || undefined)
    } catch {
      return { ok: false, erro: 'Biblioteca inválida: use dono/repo ou uma URL https do repositório.' }
    }
    // the setting changes only once the new library is in place
    const r = switchLibrary(url, paths().lib)
    if (!r.ok) return done({ ok: false, erro: r.aviso })
    engine.state.settings = setSkillsLibrary(repo)
    if (r.antiga) diagLog('skills', 'info', 'biblioteca trocada: a cópia antiga ficou guardada', { antiga: r.antiga })
    return done({ ok: true })
  }, ruleOf('skills:setLibrary'))
}
