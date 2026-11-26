// The skills_* gateway tools in main. Only skills threads (/skill-init, /skill-refresh, /skill-install)
// may call them, and every change waits for its own approval card.
import type { CatalogItem, SkillsList } from '../../shared/types.ts'
import type { GwHandler } from '../connectors/gateway-server.ts'
import { itemFor, readCatalog } from './catalog.ts'
import { createInstallTools } from './handler-install.ts'
import { REFUSED, catalog, confirm, list, needLibrary, save, str, type Ctx, type SkillsDeps } from './handler-ctx.ts'
import { pushLibrary } from './library.ts'
import { emptyList, readList, turnOff, turnOn } from './project-list.ts'

export type { SkillsDeps } from './handler-ctx.ts'

export const NOT_SKILLS_THREAD = 'Ferramenta de skills só roda em /skill-init, /skill-refresh ou /skill-install.'

function catalogTool(c: Ctx) {
  const r = readCatalog(c.d.paths.lib)
  const l = readList(c.path)
  const erro = [r.erro, l.erro].filter(Boolean).join('; ')
  return {
    itens: r.itens.map((i) => ({
      id: i.id,
      tipo: i.tipo,
      descricao: i.descricao,
      tags: i.tags,
      ...(i.sempre ? { sempre: true } : {}),
      ...(i.corporativo ? { corporativo: true } : {}),
    })),
    lista: l.list,
    ...(erro ? { erro } : {}),
  }
}

async function add(c: Ctx): Promise<string> {
  const id = str(c, 'id')
  const motivo = str(c, 'motivo')
  const it = itemFor(catalog(c), id)
  if (!it) throw new Error('Item fora do catálogo: use skills_resolve.')
  list(c)
  if (!(await confirm(c, 'skills_add', `Ligar ${id} neste projeto`, `Motivo: ${motivo}\n${it.descricao}`))) return REFUSED
  // read again: the panel may have changed the list while the card waited
  save(c, turnOn(list(c) ?? emptyList(), it))
  const done = `Ligado neste projeto: ${id}. Vale a partir da próxima thread.`
  if (it.tipo !== 'plugin' || c.d.installed().has(id)) return done
  const r = await c.d.install(id, it)
  return r.ok ? `${done} Plugin instalado.` : `Ligado na lista, mas a instalação falhou: ${r.erro ?? 'erro desconhecido'}`
}

/** An id the list has but the catalog lost (a plugin turned on from the panel, an item taken out of the library). */
function listed(l: SkillsList, id: string): CatalogItem | undefined {
  if (l.plugins.some((p) => p.id === id)) return { id, tipo: 'plugin', descricao: '', tags: [] }
  if (l.skills.includes(id)) return { id, tipo: 'skill', descricao: '', tags: [] }
  return undefined
}

async function remove(c: Ctx): Promise<string> {
  const id = str(c, 'id')
  const motivo = str(c, 'motivo')
  const itens = catalog(c)
  const current = list(c)
  // without a list the project runs on the old set; a list made here would drop all of it
  if (!current) throw new Error('Projeto sem lista: rode /skill-init antes de tirar itens.')
  const it = itemFor(itens, id) ?? listed(current, id)
  if (!it) throw new Error(`${id} não está no catálogo nem na lista do projeto.`)
  const detail = it.descricao ? `Motivo: ${motivo}\n${it.descricao}` : `Motivo: ${motivo}`
  if (!(await confirm(c, 'skills_remove', `Tirar ${id} deste projeto`, detail))) return REFUSED
  save(c, turnOff(list(c) ?? current, it))
  return `Tirado deste projeto: ${id}. Vale a partir da próxima thread.`
}

async function push(c: Ctx): Promise<string> {
  needLibrary(c)
  const ok = await confirm(c, 'skills_push', 'Enviar a biblioteca para o GitHub (git push)', 'Os commits feitos no clone da biblioteca sobem para o repositório dela.')
  if (!ok) return REFUSED
  const r = pushLibrary(c.d.paths.lib, c.d.git)
  if (!r.ok) throw new Error(`git push da biblioteca falhou: ${r.erro}`)
  return 'Biblioteca enviada.'
}

export function createSkillsHandler(d: SkillsDeps): GwHandler {
  const install = createInstallTools()
  const tools: Record<string, (c: Ctx) => Promise<unknown>> = {
    skills_catalog: async (c) => catalogTool(c),
    skills_add: add,
    skills_remove: remove,
    skills_resolve: install.resolve,
    skills_import: install.importStaged,
    skills_push: push,
  }
  return async (ref, req, signal) => {
    const found = d.findThread(ref)
    if (!found) throw new Error('Thread encerrada')
    const { p, t } = found
    if (!t.skillsTask) throw new Error(NOT_SKILLS_THREAD)
    if (!p.path) throw new Error('Esse comando precisa de um projeto com pasta.')
    const run = req.tool && Object.hasOwn(tools, req.tool) ? tools[req.tool] : undefined
    if (!run) throw new Error(`Ferramenta de skills desconhecida: ${req.tool ?? ''}`)
    const args = req.args && typeof req.args === 'object' && !Array.isArray(req.args) ? (req.args as Record<string, unknown>) : {}
    return run({ d, p, t, path: p.path, args, signal })
  }
}
