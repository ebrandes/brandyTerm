/** Which of the user's plugins the sidebar "Skills" section shows: search, enabled first, a row limit. */
export const PLUGIN_LIMIT = 8

interface Listed {
  id: string
  name: string
  on: boolean
}

export interface PluginView<T> {
  rows: T[]
  /** matches left out by the limit (0 when expanded or searching) */
  hidden: number
  /** matches for the current query */
  matches: number
  /** the search box only shows up for long lists */
  searchable: boolean
  /** "Mostrar todos" / "Mostrar menos" has something to do */
  canExpand: boolean
}

/** `name@marketplace` or `name@marketplace#/project/path` -> `marketplace` */
export const marketplaceOf = (id: string) => id.split('#')[0].split('@')[1] ?? ''

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function matchesPlugin(p: Listed, query: string): boolean {
  const q = fold(query.trim())
  return !q || fold(p.name).includes(q) || fold(marketplaceOf(p.id)).includes(q)
}

/**
 * Enabled plugins first and always shown; the rest fill up to `limit` rows unless the list is
 * expanded or a search is typed (then every match shows). Order within each group is kept.
 */
export function viewPlugins<T extends Listed>(list: T[], query: string, expanded: boolean, limit = PLUGIN_LIMIT): PluginView<T> {
  const found = list.filter((p) => matchesPlugin(p, query))
  const on = found.filter((p) => p.on)
  const off = found.filter((p) => !p.on)
  const searching = query.trim() !== ''
  const room = expanded || searching ? off.length : Math.max(0, limit - on.length)
  const rows = [...on, ...off.slice(0, room)]
  const collapsedRows = on.length + Math.min(off.length, Math.max(0, limit - on.length))
  return {
    rows,
    hidden: found.length - rows.length,
    matches: found.length,
    searchable: list.length > limit,
    canExpand: !searching && found.length > collapsedRows
  }
}
