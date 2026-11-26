import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CatalogItem, SkillsList } from '../../shared/types.ts'

export const listPath = (projectPath: string) => join(projectPath, '.brandyterm', 'skills.json')

export const emptyList = (): SkillsList => ({ versao: 1, plugins: [], skills: [], sem: [] })

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s) : [])

function plugins(v: unknown): SkillsList['plugins'] {
  if (!Array.isArray(v)) return []
  const out: SkillsList['plugins'] = []
  for (const p of v) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id) continue
    out.push(typeof p.ref === 'string' && p.ref ? { id: p.id, ref: p.ref } : { id: p.id })
  }
  return out
}

/** Reads the project's list. Missing → `{list:null}`; bad JSON → `{list:null, erro}`. */
export function readList(projectPath: string): { list: SkillsList | null; erro?: string } {
  let text: string
  try {
    text = readFileSync(listPath(projectPath), 'utf8')
  } catch {
    return { list: null }
  }
  try {
    const raw = JSON.parse(text)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { list: null, erro: 'skills.json inválido' }
    return { list: { versao: 1, plugins: plugins(raw.plugins), skills: strings(raw.skills), sem: strings(raw.sem) } }
  } catch {
    return { list: null, erro: 'skills.json inválido' }
  }
}

export function writeList(projectPath: string, list: SkillsList): void {
  const file = listPath(projectPath)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(list, null, 2) + '\n')
}

/** Turns an item on for the project. A `sempre` item is already in; turning it on only clears `sem`. */
export function turnOn(list: SkillsList, item: CatalogItem): SkillsList {
  const next: SkillsList = { ...list, sem: list.sem.filter((id) => id !== item.id) }
  if (item.sempre) return next
  if (item.tipo === 'plugin') {
    if (!list.plugins.some((p) => p.id === item.id)) next.plugins = [...list.plugins, { id: item.id }]
  } else if (!list.skills.includes(item.id)) {
    next.skills = [...list.skills, item.id]
  }
  return next
}

/** Turns an item off: drops it from the list, and puts a `sempre` item in `sem`. */
export function turnOff(list: SkillsList, item: CatalogItem): SkillsList {
  const next: SkillsList = {
    ...list,
    plugins: list.plugins.filter((p) => p.id !== item.id),
    skills: list.skills.filter((s) => s !== item.id),
  }
  if (item.sempre && !list.sem.includes(item.id)) next.sem = [...list.sem, item.id]
  return next
}
