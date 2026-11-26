// Reading connectors.json without losing an entry: each one comes back as a Connector, the unreadable ones marked
// `broken` (listed with the reason, for Corrigir or Remover), never filtered out.
import { randomUUID } from 'node:crypto'
import type { Connector, ConnectorAuth } from '../../shared/connectors.ts'

export interface Loaded {
  items: Connector[]
  /** some entry had to be repaired: the caller keeps a copy of the file as it was */
  changed: boolean
  /** the file is not a list at all */
  fault?: string
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const strs = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined)
const AUTH_KINDS = new Set(['none', 'oauth', 'token', 'cli'])

function readOne(v: unknown, n: number, ids: Set<string>): { c: Connector; changed: boolean } {
  if (!isObj(v)) {
    const c: Connector = {
      id: randomUUID(), name: `Entrada ilegível ${n}`, description: '', transport: 'stdio', auth: { kind: 'none' },
      enabled: false, alwaysAllow: [], broken: 'Esta entrada do connectors.json não é um conector (cópia guardada ao lado do arquivo)',
    }
    return { c, changed: true }
  }
  const fixes: string[] = []
  let id = typeof v.id === 'string' && v.id ? v.id : ''
  if (!id || ids.has(id)) { id = randomUUID(); fixes.push('id') }
  const name = typeof v.name === 'string' && v.name.trim() ? v.name : `Sem nome ${n}`
  if (name !== v.name) fixes.push('name')
  const auth = isObj(v.auth) && AUTH_KINDS.has(String(v.auth.kind)) ? (v.auth as unknown as ConnectorAuth) : { kind: 'none' as const }
  if (auth !== v.auth) fixes.push('auth')
  const alwaysAllow = strs(v.alwaysAllow) ?? []
  if (!Array.isArray(v.alwaysAllow) || alwaysAllow.length !== v.alwaysAllow.length) fixes.push('alwaysAllow')
  const description = typeof v.description === 'string' ? v.description : ''
  if (description !== v.description) fixes.push('description')
  const enabled = v.enabled === true
  if (enabled !== v.enabled) fixes.push('enabled')
  const c = { ...v, id, name, description, auth, enabled, alwaysAllow } as unknown as Connector
  for (const k of ['args', 'projects', 'envKeys', 'headerKeys'] as const) {
    if (v[k] === undefined) continue
    const list = strs(v[k])
    if (list && list.length === (v[k] as unknown[]).length) continue
    fixes.push(k)
    if (list) c[k] = list
    else delete c[k]
  }
  return { c, changed: fixes.length > 0 }
}

export function readConnectors(text: string): Loaded {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { items: [], changed: true, fault: 'connectors.json ilegível: nenhum conector carregado (cópia guardada ao lado do arquivo)' }
  }
  if (!Array.isArray(raw)) return { items: [], changed: true, fault: 'connectors.json não é uma lista: nenhum conector carregado (cópia guardada ao lado do arquivo)' }
  const ids = new Set<string>()
  let changed = false
  const items = raw.map((v, i) => {
    const r = readOne(v, i + 1, ids)
    ids.add(r.c.id)
    changed ||= r.changed
    return r.c
  })
  return { items, changed }
}
