import { useEffect, useRef } from 'react'
import { Puzzle, Sparkles, SquareSlash } from 'lucide-react'
import type { SlashCommand } from '../types'

/** Ranks commands for the typed text: prefix, then prefix of the part after "plugin:", substring, then letters in order. */
export function matchCommands(all: SlashCommand[], q: string): SlashCommand[] {
  const query = q.toLowerCase()
  const score = (c: SlashCommand): number => {
    const n = c.name.toLowerCase()
    const tail = n.slice(n.indexOf(':') + 1)
    if (!query) return c.source === 'app' ? 0 : 1
    if (n.startsWith(query)) return 0
    if (tail.startsWith(query)) return 1
    if (n.includes(query)) return 2
    let i = 0
    for (const ch of n) if (ch === query[i]) i++
    return i === query.length ? 3 : -1
  }
  return all
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.c.name.length - b.c.name.length)
    .map((x) => x.c)
    .slice(0, 40)
}

const ICON = { app: <SquareSlash size={13} />, plugin: <Puzzle size={13} />, project: <Sparkles size={13} /> }
const SOURCE = { app: 'BrandyTerm', plugin: 'plugin', project: 'projeto' }

interface Props {
  items: SlashCommand[]
  active: number
  onHover: (i: number) => void
  onPick: (c: SlashCommand) => void
}

export function SlashMenu({ items, active, onHover, onPick }: Props) {
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <ul className="slash-menu" role="listbox" aria-label="Comandos" ref={list}>
      {items.map((c, i) => (
        <li
          key={c.name}
          role="option"
          aria-selected={i === active}
          className={i === active ? 'on' : ''}
          onMouseMove={() => i !== active && onHover(i)}
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(c)
          }}
        >
          <span className="slash-icon">{ICON[c.source]}</span>
          <span className="slash-name">/{c.name}</span>
          <span className="slash-desc">{c.description}</span>
          <span className="slash-src">{SOURCE[c.source]}</span>
        </li>
      ))}
    </ul>
  )
}
