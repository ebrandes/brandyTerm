import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CatalogItem } from '../../shared/types.ts'

export const catalogPath = (libRoot: string) => join(libRoot, 'biblioteca', 'catalogo.json')

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])

function toItem(raw: unknown): CatalogItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  if (r.tipo !== 'plugin' && r.tipo !== 'skill') return null
  const item: CatalogItem = {
    id: r.id,
    tipo: r.tipo,
    descricao: typeof r.descricao === 'string' ? r.descricao : '',
    tags: strings(r.tags),
  }
  if (r.sempre === true) item.sempre = true
  if (r.corporativo === true) item.corporativo = true
  const plats = strings(r.plataformas).filter((p): p is 'mac' | 'win' => p === 'mac' || p === 'win')
  if (plats.length) item.plataformas = plats
  if (typeof r.loja === 'string' && r.loja) item.loja = r.loja
  return item
}

/** Reads `<libRoot>/biblioteca/catalogo.json`. Missing file → empty; bad JSON → empty plus `erro`. */
export function readCatalog(libRoot: string): { itens: CatalogItem[]; erro?: string } {
  let text: string
  try {
    text = readFileSync(catalogPath(libRoot), 'utf8')
  } catch {
    return { itens: [] }
  }
  try {
    const raw = JSON.parse(text)
    const list: unknown[] = Array.isArray(raw?.itens) ? raw.itens : []
    return { itens: list.map(toItem).filter((i): i is CatalogItem => i !== null) }
  } catch {
    return { itens: [], erro: 'catalogo.json inválido' }
  }
}

/** Adds or replaces an item by id; the file stays sorted by id, 2-space JSON, trailing newline. */
export function upsertCatalog(libRoot: string, item: CatalogItem): void {
  const itens = readCatalog(libRoot).itens.filter((i) => i.id !== item.id)
  itens.push(item)
  itens.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const file = catalogPath(libRoot)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ versao: 1, itens }, null, 2) + '\n')
}

export const itemFor = (itens: CatalogItem[], id: string): CatalogItem | undefined => itens.find((i) => i.id === id)

/** False only when the item names platforms and this one isn't among them. */
export function forPlatform(item: CatalogItem, platform: NodeJS.Platform): boolean {
  if (!item.plataformas?.length) return true
  const here = platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : null
  return here !== null && item.plataformas.includes(here)
}
