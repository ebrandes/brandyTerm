import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { wireClipboard } from './terminal-clipboard'
import { api } from './api'

/**
 * xterm instances live outside React, one per project, so the scrollback
 * survives switching projects and hiding the panel. The panel only mounts
 * the instance's host element.
 */

interface Entry {
  term: Terminal
  fit: FitAddon
  host: HTMLDivElement
  started: boolean
  alive: boolean
}

const entries = new Map<string, Entry>()
let wired = false

function wire(): void {
  if (wired) return
  wired = true
  api.term.onData(({ id, data }) => entries.get(id)?.term.write(data))
  api.term.onExit(({ id, exitCode }) => {
    const e = entries.get(id)
    if (!e) return
    e.alive = false
    e.started = false
    e.term.write(`\r\n\x1b[2m[processo encerrado (${exitCode}). Pressione Enter para abrir outro shell]\x1b[0m\r\n`)
  })
}

export function terminalFor(id: string): Entry {
  wire()
  let e = entries.get(id)
  if (e) return e
  const term = new Terminal({
    fontFamily: "'JetBrains Mono','Cascadia Code',Menlo,Consolas,monospace",
    fontSize: 12.5,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: false,
    theme: { background: '#0c0c10', foreground: '#dcdce6', cursor: '#8b7cf6', selectionBackground: 'rgba(139,124,246,.35)' }
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const host = document.createElement('div')
  host.className = 'term-host'
  term.open(host)
  wireClipboard(term, host)
  const entry: Entry = { term, fit, host, started: false, alive: false }
  term.onData((data) => {
    if (!entry.alive) {
      // only project shells restart on Enter; other terminals belong to a flow (account or connector login)
      if (data === '\r' && !id.startsWith('account-') && !id.startsWith('connector-')) void start(id)
      return
    }
    void api.term.write({ id, data })
  })
  term.onResize(({ cols, rows }) => entry.alive && void api.term.resize({ id, cols, rows }))
  entries.set(id, entry)
  return entry
}

/** Marks a terminal whose pty the main process started itself (account login). */
export function attach(id: string): Entry {
  const e = terminalFor(id)
  e.started = true
  e.alive = true
  return e
}

/** Forgets a terminal and its scrollback. */
export function dispose(id: string): void {
  entries.get(id)?.term.dispose()
  entries.delete(id)
}

/** Starts the project's shell if it is not running yet. */
export async function start(id: string): Promise<void> {
  const e = terminalFor(id)
  if (e.started) return
  e.started = true
  try {
    e.alive = await api.term.open({ id, cols: e.term.cols, rows: e.term.rows })
  } catch (err) {
    e.started = false
    e.alive = false
    e.term.write(`\x1b[2m[${err instanceof Error ? err.message : String(err)}]\x1b[0m\r\n`)
    return
  }
  if (!e.alive) {
    e.started = false
    e.term.write('\x1b[2m[sem pasta de projeto para abrir o terminal]\x1b[0m\r\n')
  }
}

/** Runs a command in the project's terminal: opens the panel (via the event) and types it with Enter. */
export function runInTerminal(projectId: string, command: string): void {
  window.dispatchEvent(new CustomEvent('brandy:terminal', { detail: { projectId } }))
  void start(projectId).then(() => {
    const e = entries.get(projectId)
    if (e?.alive) void api.term.write({ id: projectId, data: command.replace(/\n+$/, '') + '\r' })
  })
}
