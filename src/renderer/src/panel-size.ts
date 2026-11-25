/** Pure width math for the resizable columns (no React, no DOM), shared by useResizablePanel. */
import type { KeyStore } from './side-state.ts'

/** Which window edge the column is docked to; its handle sits on the opposite edge. */
export type PanelSide = 'left' | 'right'

export const clampWidth = (w: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, w)))

/** Largest applied width: a fixed cap and/or a share of the window, never below `min`. */
export function maxWidthFor(viewport: number, min: number, maxRatio?: number, cap?: number): number {
  const byRatio = maxRatio === undefined ? Infinity : Math.floor(viewport * maxRatio)
  const limit = Math.min(byRatio, cap ?? Infinity)
  return Math.max(min, Number.isFinite(limit) ? limit : min)
}

/** The stored preferred width, or `fallback` when missing, invalid or storage is unavailable. */
export function readWidth(store: KeyStore | undefined, key: string, fallback: number): number {
  try {
    const n = Number(store?.getItem(key))
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}

export function writeWidth(store: KeyStore | undefined, key: string, width: number): void {
  try {
    store?.setItem(key, String(width))
  } catch {
    /* storage full or disabled: the width just won't survive a reload */
  }
}

/** Column width for a pointer at `clientX`: measured from the column's own window edge. */
export const edgeDistance = (side: PanelSide, clientX: number, viewport: number) => (side === 'left' ? clientX : viewport - clientX)

/** Arrow key that widens the column: the one pointing away from its docked edge. */
export const widenKey = (side: PanelSide) => (side === 'left' ? 'ArrowRight' : 'ArrowLeft')
