import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ThreadFile } from '../types'
import { fileName } from '../file-chips'
import { iconOf } from './file-icon'

export type FileState = 'criado' | 'editado' | 'apagado'

const WIDTH = 360
const MARGIN = 8

/** Fixed position under the button, or above it when there is little room below; kept inside the window. */
function placeAt(btn: HTMLElement): CSSProperties {
  const r = btn.getBoundingClientRect()
  const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - WIDTH - MARGIN))
  const below = window.innerHeight - r.bottom - MARGIN
  const above = r.top - MARGIN
  return below >= 220 || below >= above
    ? { left, top: r.bottom + 4, maxHeight: below - 4 }
    : { left, bottom: window.innerHeight - r.top + 4, maxHeight: above - 4 }
}

/** '+N…' button that opens the full list of the run's files; Esc, a click outside, Tab or scrolling close it. */
export function FileChipsMenu({ files, hidden, stateOf, onOpen }: {
  files: ThreadFile[]
  hidden: number
  stateOf: (f: ThreadFile) => FileState
  onOpen: (f: ThreadFile) => void
}) {
  const [style, setStyle] = useState<CSSProperties | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const open = style !== null

  const close = (refocus: boolean) => {
    setStyle(null)
    if (refocus) btnRef.current?.focus()
  }
  const show = () => btnRef.current && setStyle(placeAt(btnRef.current))

  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    ;(menu?.querySelector<HTMLElement>('[role=menuitem]:not(:disabled)') ?? menu)?.focus()
    const outside = (t: EventTarget | null) => !menu?.contains(t as Node) && !btnRef.current?.contains(t as Node)
    const onDown = (e: MouseEvent) => outside(e.target) && setStyle(null)
    const onScroll = (e: Event) => !menu?.contains(e.target as Node) && setStyle(null)
    const onResize = () => setStyle(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const onMenuKey = (e: KeyboardEvent) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled)') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const go = (n: number) => {
      e.preventDefault()
      items[(n + items.length) % items.length]?.focus()
    }
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      close(true)
    } else if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i < 0 ? -1 : i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(-1)
  }

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' && !open) {
      e.preventDefault()
      show()
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      close(true)
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="fchips-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={`Ver os ${files.length} arquivos`}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={onButtonKey}
      >
        +{hidden}…
      </button>
      {open &&
        createPortal(
          <div ref={menuRef} id={id} role="menu" aria-label="Arquivos da thread" tabIndex={-1} className="fchips-menu" style={style} onKeyDown={onMenuKey}>
            {files.map((f) => {
              const Icon = iconOf(f.path)
              const state = stateOf(f)
              const name = fileName(f.path)
              return (
                <button
                  key={f.path}
                  type="button"
                  role="menuitem"
                  className="fchips-item"
                  disabled={state === 'apagado'}
                  title={state === 'apagado' ? 'O arquivo não existe mais.' : `${f.path} — abrir`}
                  onClick={() => {
                    close(false)
                    onOpen(f)
                  }}
                >
                  <Icon size={14} />
                  <span className="fchips-item-text">
                    <span className="fchips-item-name">{name}</span>
                    {name !== f.path && <span className="fchips-item-path">{f.path}</span>}
                  </span>
                  <span className="fchips-item-state">
                    <span className={`fstate ${state}`} aria-hidden />
                    {state}
                  </span>
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </>
  )
}
