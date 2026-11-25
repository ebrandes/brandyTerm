import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { readOpen, writeOpen } from '../side-state'
import './side-section.css'

const store = () => (typeof localStorage === 'undefined' ? undefined : localStorage)

interface Props {
  /** remembered as `brandy.side.<id>` */
  id: string
  title: string
  /** muted text on the right of the header, e.g. a count */
  summary?: ReactNode
  /** icon buttons on the far right; clicking them never toggles the section */
  actions?: ReactNode
  /** shows the body regardless of the remembered state (e.g. a pending login) */
  forceOpen?: boolean
  children: ReactNode
}

/** Collapsible sidebar section: chevron, title and summary on one line; closed by default. */
export function SideSection({ id, title, summary, actions, forceOpen, children }: Props) {
  const [stored, setStored] = useState(() => readOpen(store(), id))
  const open = stored || !!forceOpen
  const toggle = () => {
    const next = !open
    setStored(next)
    writeOpen(store(), id, next)
  }
  return (
    <section className="side-sec">
      <div className="side-head side-sec-head">
        <button className="side-sec-toggle" onClick={toggle} aria-expanded={open} aria-controls={`side-${id}`}>
          <ChevronRight size={12} className={`side-chev${open ? ' open' : ''}`} />
          <span className="side-title">{title}</span>
          {summary !== undefined && <span className="side-summary">{summary}</span>}
        </button>
        {actions && (
          <span className="side-actions" onClick={(e) => e.stopPropagation()}>
            {actions}
          </span>
        )}
      </div>
      {open && (
        <div className="side-body" id={`side-${id}`}>
          {children}
        </div>
      )}
    </section>
  )
}
