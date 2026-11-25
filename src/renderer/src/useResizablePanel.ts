import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { clampWidth, edgeDistance, maxWidthFor, readWidth, widenKey, writeWidth, type PanelSide } from './panel-size.ts'

interface Options {
  /** localStorage key for the preferred width */
  storageKey: string
  defaultWidth: number
  minWidth: number
  /** largest share of the window the panel may take (0..1) */
  maxRatio?: number
  /** fixed largest width in px (combined with maxRatio when both are given) */
  maxWidth?: number
  /** window edge the panel is docked to; default 'right' */
  side?: PanelSide
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

const store = () => (typeof localStorage === 'undefined' ? undefined : localStorage)

/**
 * Width of a panel docked to the left or right edge of the window, resized by dragging a
 * handle on its inner edge. The preferred width is persisted; the applied width is clamped to
 * [minWidth, min(maxWidth, maxRatio * window width)], so shrinking the window never loses the preference.
 */
export function useResizablePanel({ storageKey, defaultWidth, minWidth, maxRatio, maxWidth: cap, side = 'right', step = 16 }: Options) {
  const [preferred, setPreferred] = useState(() => readWidth(store(), storageKey, defaultWidth))
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const [dragging, setDragging] = useState(false)
  const grab = useRef(0)

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const maxWidth = maxWidthFor(viewport, minWidth, maxRatio, cap)
  const clamp = useCallback((w: number) => clampWidth(w, minWidth, maxWidth), [minWidth, maxWidth])
  const width = clamp(preferred)

  // persist once a gesture ends, not on every pointer move
  useEffect(() => {
    if (dragging) return
    writeWidth(store(), storageKey, preferred)
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
      grab.current = edgeDistance(side, e.clientX, window.innerWidth) - width
      setDragging(true)
    },
    onPointerMove: (e) => {
      if (!dragging) return
      setPreferred(clamp(edgeDistance(side, e.clientX, window.innerWidth) - grab.current))
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
      // the handle sits on the panel's inner edge: moving it away from the docked edge widens the panel
      if (e.key === widenKey(side)) next = width + delta
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') next = width - delta
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
