import { useEffect, useState, type RefObject } from 'react'
import type { FsEntry } from './types'

export interface MentionToken {
  /** index of the "@" */
  start: number
  query: string
  /** typed as @"path with spaces */
  quoted: boolean
}

/** The "@query" token right before the caret: it starts the text or follows whitespace. */
export function mentionAt(text: string, caret: number): MentionToken | null {
  const m = /(^|\s)@("[^"]*|[^\s@"]*)$/.exec(text.slice(0, caret))
  if (!m) return null
  const quoted = m[2].startsWith('"')
  return { start: caret - m[2].length - 1, query: quoted ? m[2].slice(1) : m[2], quoted }
}

/**
 * Text after picking `e` for `tok`, and where the caret goes. Folders keep the
 * token open (caret before the closing quote, if any) so the next level shows up;
 * files close it with a space.
 */
export function applyMention(draft: string, caret: number, tok: MentionToken, e: FsEntry): { text: string; caret: number } {
  const quote = tok.quoted || /\s/.test(e.path)
  const end = tok.quoted && draft[caret] === '"' ? caret + 1 : caret
  const ref = quote ? `@"${e.path}"` : `@${e.path}`
  const inserted = e.kind === 'dir' ? ref : `${ref} `
  const pos = tok.start + inserted.length - (e.kind === 'dir' && quote ? 1 : 0)
  return { text: draft.slice(0, tok.start) + inserted + draft.slice(end), caret: pos }
}

/** "@" file/folder mentions in the composer: tracks the caret, fetches matches and handles the menu keys. */
export function useMention(projectId: string, draft: string, onDraft: (t: string) => void, box: RefObject<HTMLTextAreaElement | null>) {
  const [caret, setCaret] = useState(0)
  const [items, setItems] = useState<FsEntry[]>([])
  const [pick, setPick] = useState(0)
  const [off, setOff] = useState(false)
  const tok = mentionAt(draft, caret)
  const query = tok?.query

  useEffect(() => {
    setOff(false)
    if (query === undefined) return setItems([])
    let alive = true
    const t = setTimeout(() => {
      void window.brandy.listFiles({ projectId, query }).then((r) => {
        if (!alive) return
        setItems(r)
        setPick(0)
      })
    }, 80)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [projectId, query])

  const open = !!tok && !off && items.length > 0
  const sync = (e: { currentTarget: HTMLTextAreaElement }) => setCaret(e.currentTarget.selectionStart)

  const insert = (e: FsEntry) => {
    if (!tok) return
    const next = applyMention(draft, caret, tok, e)
    onDraft(next.text)
    setCaret(next.caret)
    requestAnimationFrame(() => {
      box.current?.focus()
      box.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  /** true when the key was handled by the menu */
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = items.length
      setPick((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
      return true
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing)) {
      e.preventDefault()
      insert(items[Math.min(pick, items.length - 1)])
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOff(true)
      return true
    }
    return false
  }

  return { open, items, pick, setPick, insert, onKey, sync }
}
