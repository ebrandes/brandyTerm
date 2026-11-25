import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { start, terminalFor } from '../terminals'
import './terminal.css'

interface Props {
  projectId: string
  path: string | null
  onClose: () => void
}

/** VS Code-style terminal docked under the chat, running in the project folder. */
export function TerminalPanel({ projectId, path, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const e = terminalFor(projectId)
    el.appendChild(e.host)
    const fit = () => {
      try {
        e.fit.fit()
      } catch {
        // not laid out yet
      }
    }
    fit()
    void start(projectId)
    e.term.focus()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => {
      ro.disconnect()
      e.host.remove()
    }
  }, [projectId])

  return (
    <section className="term-panel" aria-label="Terminal integrado">
      <header className="term-head">
        <span>Terminal</span>
        <span className="term-path">{path}</span>
        <button className="icon-btn sm" onClick={onClose} aria-label="Fechar terminal" title="Fechar (o shell continua aberto)">
          <X size={13} />
        </button>
      </header>
      <div className="term-box" ref={box} />
    </section>
  )
}
