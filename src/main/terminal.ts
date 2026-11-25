import { clipboard, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { spawn, type IPty } from '@lydell/node-pty'
import { registry } from './rpc/registry.ts'
import { local } from './rpc/local-only-guard.ts'
import { ruleOf } from './rpc/channels.ts'

/**
 * Integrated terminal: one shell per project, started in the project folder on
 * first open and kept alive while the app runs (closing the panel only hides it).
 */

const ptys = new Map<string, IPty>()
/** ptys whose width the renderer must not change (their output is parsed) */
const fixed = new Set<string>()
/** where each pty's output goes; a reopened window takes it over */
const senders = new Map<string, WebContents>()

function shell(): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: process.env.COMSPEC || 'powershell.exe', args: [] }
  // login shell: GUI apps on macOS start without the user's PATH
  return { file: process.env.SHELL || '/bin/zsh', args: ['-l'] }
}

interface PtyOpts {
  file: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env?: Record<string, string | undefined>
  /** keep this width: resizes from the renderer are ignored */
  fixedCols?: boolean
  onData?: (data: string) => void
  onExit?: (exitCode: number) => void
}

/** drops unset variables (an `undefined` value would reach the child as the text "undefined") */
function cleanEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((kv): kv is [string, string] => kv[1] !== undefined))
}

/** Runs a program in a pty whose screen is the renderer's xterm with the same id. */
export function spawnPty(sender: WebContents, id: string, o: PtyOpts): void {
  // a window opened again takes over the output of the pty that kept running
  if (ptys.has(id)) return void senders.set(id, sender)
  senders.set(id, sender)
  const pty = spawn(o.file, o.args, {
    name: 'xterm-256color',
    cols: Math.max(o.cols, 20),
    rows: Math.max(o.rows, 5),
    cwd: existsSync(o.cwd) ? o.cwd : homedir(),
    env: cleanEnv({ ...process.env, TERM_PROGRAM: 'BrandyTerm', ...o.env })
  })
  ptys.set(id, pty)
  if (o.fixedCols) fixed.add(id)
  const to = () => {
    const s = senders.get(id)
    return s && !s.isDestroyed() ? s : undefined
  }
  pty.onData((data) => {
    o.onData?.(data)
    if (ptys.get(id) === pty) to()?.send('term:data', { id, data })
  })
  pty.onExit(({ exitCode }) => {
    o.onExit?.(exitCode)
    // killed and replaced under the same id: the new one keeps its slot and its window
    if (ptys.has(id) && ptys.get(id) !== pty) return
    ptys.delete(id)
    fixed.delete(id)
    to()?.send('term:exit', { id, exitCode })
    senders.delete(id)
  })
}

function open(sender: WebContents, id: string, cwd: string, cols: number, rows: number): void {
  spawnPty(sender, id, { ...shell(), cwd, cols, rows })
}

/** the terminal copies and pastes through the system clipboard (no renderer clipboard permission needed) */
function registerClipboardIpc(): void {
  registry.add('clipboard:read', () => clipboard.readText(), ruleOf('clipboard:read'))
  registry.add('clipboard:write', (text: string) => clipboard.writeText(String(text)), ruleOf('clipboard:write'))
}

export function registerTerminalIpc(cwdOf: (projectId: string) => string | null | undefined): void {
  registerClipboardIpc()
  registry.add('term:open', local((a: { id: string; cols: number; rows: number }, ctx) => {
    const cwd = cwdOf(String(a.id))
    if (!cwd) return false
    open(ctx.sender as WebContents, String(a.id), cwd, Number(a.cols) || 80, Number(a.rows) || 24)
    return true
  }), ruleOf('term:open'))
  registry.add('term:write', local((a: { id: string; data: string }) => ptys.get(String(a.id))?.write(String(a.data))), ruleOf('term:write'))
  registry.add('term:resize', local((a: { id: string; cols: number; rows: number }) => {
    const cols = Math.max(Number(a.cols) || 0, 20)
    const rows = Math.max(Number(a.rows) || 0, 5)
    try {
      const pty = ptys.get(String(a.id))
      if (pty) pty.resize(fixed.has(String(a.id)) ? pty.cols : cols, rows)
    } catch {
      // the shell may have just exited
    }
  }), ruleOf('term:resize'))
  registry.add('term:kill', local((id: string) => killTerminal(String(id))), ruleOf('term:kill'))
}

export function killTerminal(id: string): void {
  ptys.get(id)?.kill()
  ptys.delete(id)
}

export function killAllTerminals(): void {
  for (const id of [...ptys.keys()]) killTerminal(id)
}
