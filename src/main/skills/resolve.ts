import type { CatalogItem, SkillsList } from '../../shared/types.ts'
import { forPlatform, itemFor } from './catalog.ts'

export interface Resolved {
  pluginDirs: string[]
  skills: string[]
  missing: { id: string; tipo: 'plugin' | 'skill' }[]
}

export interface ResolveInput {
  list: SkillsList
  itens: CatalogItem[]
  /** plugin id → install dir */
  installed: Map<string, string>
  /** folder names under biblioteca/skills */
  libSkills: Set<string>
  platform: NodeJS.Platform
}

/**
 * What a thread of this project receives: the catalog's `sempre` items (minus `sem`)
 * plus the list's plugins and skills. Items for another system are skipped silently;
 * items that aren't installed (or not in the library) go to `missing`.
 */
export function resolveProject(i: ResolveInput): Resolved {
  const out: Resolved = { pluginDirs: [], skills: [], missing: [] }
  const seen = new Set<string>()
  const sem = new Set(i.list.sem)

  const add = (id: string, tipo: 'plugin' | 'skill') => {
    if (seen.has(id)) return
    seen.add(id)
    const known = itemFor(i.itens, id)
    if (known && !forPlatform(known, i.platform)) return
    if (tipo === 'plugin') {
      const dir = i.installed.get(id)
      if (dir) out.pluginDirs.push(dir)
      else out.missing.push({ id, tipo })
    } else if (i.libSkills.has(id)) out.skills.push(id)
    else out.missing.push({ id, tipo })
  }

  for (const it of i.itens) if (it.sempre && !sem.has(it.id)) add(it.id, it.tipo)
  for (const p of i.list.plugins) add(p.id, 'plugin')
  for (const s of i.list.skills) add(s, 'skill')
  return out
}
