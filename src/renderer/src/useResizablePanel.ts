import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'

interface Options {
  /** localStorage key for the preferred width */
  storageKey: string
  defaultWidth: number
  minWidth: number
  /** largest share of the window the panel may take (0..1) */
  maxRatio: number
  /** keyboard step in px; Shift multiplies it by 4 */
  step?: number
}

export interface ResizeHandleProps {
  role: 'separator'
  tabIndex: number
  'aria-orientation': 'vertical'
  'aria-valuenow': number
  'aria-valuemin': number
  'aria-valuemax': number
  onPointerDown: (e: PointerEvent<HTMLElement>) => void
  onPointerMove: (e: PointerEvent<HTMLElement>) => void
  onPointerUp: (e: PointerEvent<HTMLElement>) => void
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void
  onLostPointerCapture: () => void
  onDoubleClick: () => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
}

function readStored(key: string, fallback: number): number {
  try {
    const n = Number(localStorage.getItem(key))
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}

/**
 * Width of a panel docked to the right edge of the window, resized by dragging a handle
 * on its left edge. The preferred width is persisted; the applied width is clamped to
 * [minWidth, maxRatio * window width], so shrinking the window never loses the preference.
 */
export function useResizablePanel({ storageKey, defaultWidth, minWidth, maxRatio, step = 16 }: Options) {
  const [preferred, setPreferred] = useState(() => readStored(storageKey, defaultWidth))
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const [dragging, setDragging] = useState(false)
  const grab = useRef(0)

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const maxWidth = Math.max(minWidth, Math.floor(viewport * maxRatio))
  const clamp = useCallback((w: number) => Math.round(Math.min(maxWidth, Math.max(minWidth, w))), [minWidth, maxWidth])
  const width = clamp(preferred)

  // persist once a gesture ends, not on every pointer move
  useEffect(() => {
    if (dragging) return
    try {
      localStorage.setItem(storageKey, String(preferred))
    } catch {
      /* storage full or disabled: the width just won't survive a reload */
    }
  }, [dragging, preferred, storageKey])

  // keep the col-resize cursor and block text selection while dragging over other elements
  useEffect(() => {
    document.body.classList.toggle('resizing-col', dragging)
    return () => document.body.classList.remove('resizing-col')
  }, [dragging])

  const handleProps: ResizeHandleProps = {
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': 'vertical',
    'aria-valuenow': width,
    'aria-valuemin': minWidth,
    'aria-valuemax': maxWidth,
    onPointerDown: (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      // offset between the pointer and the panel edge, so the handle does not jump
      grab.current = window.innerWidth - e.clientX - width
      setDragging(true)
    },
    onPointerMove: (e) => {
      if (!dragging) return
      setPreferred(clamp(window.innerWidth - e.clientX - grab.current))
    },
    onPointerUp: (e) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      setDragging(false)
    },
    onPointerCancel: () => setDragging(false),
    onLostPointerCapture: () => setDragging(false),
    onDoubleClick: () => setPreferred(clamp(defaultWidth)),
    onKeyDown: (e) => {
      const delta = e.shiftKey ? step * 4 : step
      let next: number | null = null
      // the handle sits on the panel's left edge: moving it left widens the panel
      if (e.key === 'ArrowLeft') next = width + delta
      else if (e.key === 'ArrowRight') next = width - delta
      else if (e.key === 'Home') next = minWidth
      else if (e.key === 'End') next = maxWidth
      else if (e.key === 'Enter') next = defaultWidth
      if (next === null) return
      e.preventDefault()
      setPreferred(clamp(next))
    }
  }

  return { width, minWidth, maxWidth, dragging, handleProps }
}
