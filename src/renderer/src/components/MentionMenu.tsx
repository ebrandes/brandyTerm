import { useEffect, useRef } from 'react'
import { FileText, Folder } from 'lucide-react'
import type { FsEntry } from '../types'

interface Props {
  items: FsEntry[]
  active: number
  onHover: (i: number) => void
  onPick: (e: FsEntry) => void
}

/** Files and folders offered after "@"; same look as the slash menu. */
export function MentionMenu({ items, active, onHover, onPick }: Props) {
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <ul className="slash-menu" role="listbox" aria-label="Arquivos e pastas" ref={list}>
      {items.map((e, i) => (
        <li
          key={e.path}
          role="option"
          aria-selected={i === active}
          className={i === active ? 'on' : ''}
          onMouseMove={() => i !== active && onHover(i)}
          onMouseDown={(ev) => {
            ev.preventDefault()
            onPick(e)
          }}
        >
          <span className="slash-icon">{e.kind === 'dir' ? <Folder size={13} /> : <FileText size={13} />}</span>
          <span className="slash-name">{e.path}</span>
          <span className="slash-desc" />
          <span className="slash-src">{e.kind === 'dir' ? 'pasta' : 'arquivo'}</span>
        </li>
      ))}
    </ul>
  )
}
