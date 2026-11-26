// A project's skills panel: what its threads get (catalog + installed plugins) and the switch that
// changes the project's list. Pure: paths and installs come in from the wiring.
import type { CatalogItem, ProjectSkillsView, SkillRow, SkillsList, UserPlugin } from '../../shared/types.ts'
import { forPlatform } from './catalog.ts'
import { emptyList, readList, turnOff, turnOn, writeList } from './project-list.ts'

export interface ViewInput {
  list: SkillsList | null
  /** the list's read error: the threads fall back to the set from before the list */
  erro?: string
  itens: CatalogItem[]
  installed: UserPlugin[]
  /** loose skills present in the library clone */
  libSkills: Set<string>
  /** plain ids on for this project without a list (thread-plugins.json) */
  fallbackOn: Set<string>
  platform: NodeJS.Platform
  aviso?: string
}

const plain = (id: string) => id.split('#')[0]

/** One install per plain id, the user-scope one first. */
function byId(installed: UserPlugin[]): Map<string, UserPlugin> {
  const out = new Map<string, UserPlugin>()
  for (const p of installed) {
    const id = plain(p.id)
    if (p.scope === 'user' || !out.has(id)) out.set(id, p)
  }
  return out
}

function listed(list: SkillsList, id: string, kind: SkillRow['kind'], item?: CatalogItem): boolean {
  if (item?.sempre) return !list.sem.includes(id)
  return kind === 'plugin' ? list.plugins.some((p) => p.id === id) : list.skills.includes(id)
}

export function projectView(i: ViewInput): ProjectSkillsView {
  const inst = byId(i.installed)
  const list = i.erro ? null : i.list
  const rows: SkillRow[] = []
  const seen = new Set<string>()
  const add = (id: string, kind: SkillRow['kind'], item?: CatalogItem) => {
    if (seen.has(id)) return
    seen.add(id)
    const p = kind === 'plugin' ? inst.get(id) : undefined
    const description = item?.descricao || p?.description
    rows.push({
      id,
      name: kind === 'plugin' ? (p?.name ?? id.split('@')[0]) : id,
      kind,
      hooks: !!p?.hooks,
      skills: kind === 'plugin' ? (p?.skills ?? 0) : 1,
      commands: p?.commands ?? 0,
      agents: p?.agents ?? 0,
      ...(description ? { description } : {}),
      on: list ? listed(list, id, kind, item) : i.fallbackOn.has(id),
      installed: kind === 'plugin' ? !!p : i.libSkills.has(id),
      sempre: !!item?.sempre,
    })
  }
  for (const item of i.itens) {
    if (forPlatform(item, i.platform)) add(item.id, item.tipo, item)
    else seen.add(item.id)
  }
  for (const id of inst.keys()) add(id, 'plugin')
  // listed by hand or left by an item that went out of the catalog
  for (const p of list?.plugins ?? []) add(p.id, 'plugin')
  for (const s of list?.skills ?? []) add(s, 'skill')
  rows.sort((a, b) => Number(b.on) - Number(a.on) || a.name.localeCompare(b.name))
  return {
    hasList: !!list,
    ...(i.erro ? { erro: i.erro } : {}),
    rows,
    missing: rows.filter((r) => r.on && !r.installed).map((r) => r.id),
    ...(i.aviso ? { aviso: i.aviso } : {}),
  }
}

export interface ToggleDeps {
  itens: CatalogItem[]
  /** installed plugins by plain id */
  installed: Map<string, string>
  fallbackOn: Set<string>
  /** `item` absent: the plugin is outside the catalog and gets scanned */
  install(id: string, item?: CatalogItem): Promise<{ ok: boolean; erro?: string }>
}

/** The catalog entry, or a bare one for an installed or listed id outside the catalog. */
function itemOf(id: string, d: ToggleDeps, list: SkillsList | null): CatalogItem | undefined {
  const known = d.itens.find((i) => i.id === id)
  if (known) return known
  if (list?.skills.includes(id)) return { id, tipo: 'skill', descricao: '', tags: [] }
  if (d.installed.has(id) || list?.plugins.some((p) => p.id === id)) return { id, tipo: 'plugin', descricao: '', tags: [] }
  return undefined
}

/**
 * The panel switch. Without a list, the first change creates one from the catalog items on at
 * the moment. Turning a missing plugin on installs it (the list is written first).
 */
export async function toggle(projectPath: string, id: string, on: boolean, d: ToggleDeps): Promise<{ ok: boolean; erro?: string }> {
  const cur = readList(projectPath)
  if (cur.erro) return { ok: false, erro: `${cur.erro}: corrija o arquivo antes de mudar a lista.` }
  const item = itemOf(id, d, cur.list)
  if (!item) return { ok: false, erro: `Item desconhecido: ${id}.` }
  let list = cur.list
  if (!list) {
    list = emptyList()
    for (const i of d.itens) if (d.fallbackOn.has(i.id)) list = turnOn(list, i)
  }
  writeList(projectPath, on ? turnOn(list, item) : turnOff(list, item))
  if (!on || item.tipo !== 'plugin' || d.installed.has(id)) return { ok: true }
  const r = await d.install(id, d.itens.find((i) => i.id === id))
  return r.ok ? { ok: true } : { ok: false, erro: `Ligado na lista, mas a instalação falhou: ${r.erro ?? 'sem detalhe'}` }
}

/** "Instalar": each missing plugin, and one library update for the missing skills. */
export async function installMissing(
  view: ProjectSkillsView,
  d: Pick<ToggleDeps, 'itens' | 'install'> & { syncLibrary(): { ok: boolean; aviso?: string } }
): Promise<{ ok: boolean; erro?: string }> {
  const rows = view.rows.filter((r) => view.missing.includes(r.id))
  const erros: string[] = []
  if (rows.some((r) => r.kind === 'skill')) {
    const s = d.syncLibrary()
    if (!s.ok) erros.push(s.aviso ?? 'Biblioteca indisponível.')
  }
  for (const r of rows) {
    if (r.kind !== 'plugin') continue
    const x = await d.install(r.id, d.itens.find((i) => i.id === r.id))
    if (!x.ok) erros.push(`${r.id}: ${x.erro ?? 'falhou'}`)
  }
  return erros.length ? { ok: false, erro: erros.join('\n') } : { ok: true }
}
