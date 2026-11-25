/** Open/closed state of the sidebar's collapsible sections, kept in localStorage. */
export interface KeyStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const sideKey = (id: string) => `brandy.side.${id}`

/** The stored state, or `fallback` when nothing is stored or storage is unavailable. */
export function readOpen(store: KeyStore | undefined, id: string, fallback = false): boolean {
  try {
    const v = store?.getItem(sideKey(id))
    return v === '1' ? true : v === '0' ? false : fallback
  } catch {
    return fallback
  }
}

export function writeOpen(store: KeyStore | undefined, id: string, open: boolean): void {
  try {
    store?.setItem(sideKey(id), open ? '1' : '0')
  } catch {
    /* storage full or disabled: the section just won't remember */
  }
}
