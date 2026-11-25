import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './project-menu.css'

export interface MenuItem {
  id: string
  label: string
  icon: ReactNode
  /** why it cannot run now; the item stays focusable and shows this as its tooltip */
  disabled?: string | null
  danger?: boolean
  /** a line above this item */
  separated?: boolean
  run: () => void
}

interface Props {
  /** where it opens (viewport coordinates); it is moved back inside the window when it would overflow */
  x: number
  y: number
  label: string
  items: MenuItem[]
  /** shown under the items, e.g. why the destructive ones are off */
  note?: string | null
  /** refocus: give focus back to what opened it (Esc, an item ran); false on a click elsewhere */
  onClose: (refocus: boolean) => void
}

const MARGIN = 8

/**
 * A small menu in the app's own look (role=menu): arrows, Home/End, Enter/Space, Esc, a click
 * outside or Tab closes it. A React menu rather than Electron's native one: it follows the theme,
 * shows why an item is off, and needs no IPC round trip for projects on another machine.
 */
export function ProjectContextMenu({ x, y, label, items, note, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN))
    })
  }, [x, y, items.length])

  // once, on open: state pushes re-render the parent and must not pull focus back to the top
  useEffect(() => {
    const first = items.findIndex((i) => !i.disabled)
    buttons.current[first < 0 ? 0 : first]?.focus()
  }, [])

  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose(false)
    }
    const away = () => onClose(false)
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', away)
    window.addEventListener('resize', away)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('blur', away)
      window.removeEventListener('resize', away)
    }
  }, [onClose])

  const move = (to: number) => {
    const n = items.length
    buttons.current[((to % n) + n) % n]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = buttons.current.findIndex((b) => b === document.activeElement)
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(at + 1),
      ArrowUp: () => move(at < 0 ? -1 : at - 1),
      Home: () => move(0),
      End: () => move(items.length - 1),
      Escape: () => onClose(true),
      Tab: () => onClose(true)
    }
    const k = keys[e.key]
    if (!k) return
    e.preventDefault()
    e.stopPropagation()
    k()
  }

  const choose = (item: MenuItem) => {
    if (item.disabled) return
    onClose(true)
    item.run()
  }

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      aria-label={label}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        // React events cross the portal: keep this one from reaching the row that opened the menu
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {items.map((item, i) => (
        <div key={item.id} role="none">
          {item.separated && <div className="ctx-sep" role="separator" />}
          <button
            ref={(b) => { buttons.current[i] = b }}
            role="menuitem"
            tabIndex={-1}
            className={`ctx-item${item.danger ? ' danger' : ''}`}
            aria-disabled={item.disabled ? true : undefined}
            title={item.disabled ?? undefined}
            onClick={() => choose(item)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        </div>
      ))}
      {note && <p className="ctx-note">{note}</p>}
    </div>,
    document.body
  )
}
