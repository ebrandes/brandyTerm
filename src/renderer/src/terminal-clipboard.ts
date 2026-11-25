import type { Terminal } from '@xterm/xterm'
import { api } from './api'

const MAC = navigator.platform.toUpperCase().includes('MAC')

/**
 * Copy and paste for an xterm instance: Cmd+C / Cmd+V on macOS, Ctrl+Shift+C / Ctrl+Shift+V
 * elsewhere, and right click (copies the selection, or pastes when nothing is selected).
 * Goes through the main process clipboard, so it works without renderer clipboard access.
 */
export function wireClipboard(term: Terminal, host: HTMLElement): void {
  let pastedAt = 0
  const copy = () => {
    const text = term.getSelection()
    if (text) void api.term.writeClipboard(text)
  }
  const paste = () => {
    pastedAt = Date.now()
    void api.term.readClipboard().then((text) => text && term.paste(text))
  }

  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return true
    const mod = MAC ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && ev.shiftKey
    const key = ev.key.toLowerCase()
    if (!mod || (key !== 'c' && key !== 'v')) return true
    // on macOS Cmd+C without a selection does nothing; Ctrl+C still reaches the shell as SIGINT
    ev.preventDefault()
    if (key === 'c') copy()
    else paste()
    return false
  })

  // a native paste right after ours (menu shortcut) would type the text twice
  host.addEventListener(
    'paste',
    (ev) => {
      if (Date.now() - pastedAt < 500) {
        ev.preventDefault()
        ev.stopImmediatePropagation()
      }
    },
    true
  )

  host.addEventListener('contextmenu', (ev) => {
    ev.preventDefault()
    if (term.hasSelection()) {
      copy()
      term.clearSelection()
    } else paste()
  })
}
