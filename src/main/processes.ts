import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { ProcessInfo } from '../shared/types.ts'
import { killTree, trackChild } from './adapters/proc.ts'
import type { RunningProcess } from '../shared/proc-stop-labels.ts'
import { createProcScanner } from './proc-scan.ts'
import { stopTree, systemDeps } from './proc-stop.ts'

const MAX_LOG = 300
const PORT_RE = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/gi
// strips ANSI colors that dev servers love to print
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g

/**
 * Runs long-lived user commands (frontend on one port, backend on another…).
 * Only the user starts these, from the UI; what runs otherwise is found by proc-scan.ts.
 */
export class ProcessManager {
  private children = new Map<string, ChildProcess>()
  private stopping = new Set<string>()
  private reports = new Map<string, (error: string) => void>()

  start(cwd: string, name: string, command: string, onChange: () => void): ProcessInfo {
    const info: ProcessInfo = {
      id: randomUUID(),
      name: name.trim() || command.trim().slice(0, 30),
      command: command.trim(),
      state: 'running',
      ports: [],
      log: [],
      startedAt: new Date().toISOString()
    }
    const child = spawn(info.command, { cwd, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    trackChild(child)
    this.children.set(info.id, child)
    ;(info as RunningProcess).pid = child.pid
    this.reports.set(info.id, (error) => {
      info.log.push(`erro ao parar: ${error}`)
      onChange()
    })
    const feed = (chunk: string) => {
      for (const raw of chunk.split(/\r?\n/)) {
        const line = raw.replace(ANSI_RE, '').trimEnd()
        if (!line) continue
        info.log.push(line.slice(0, 400))
        for (const m of line.matchAll(PORT_RE)) {
          const port = Number(m[1])
          if (port > 0 && port < 65536 && !info.ports.includes(port)) info.ports.push(port)
        }
      }
      if (info.log.length > MAX_LOG) info.log.splice(0, info.log.length - MAX_LOG)
      onChange()
    }
    child.stdout?.setEncoding('utf8').on('data', feed)
    child.stderr?.setEncoding('utf8').on('data', feed)
    child.on('error', (e) => {
      info.log.push(`erro ao iniciar: ${String(e)}`)
      info.state = 'exited'
      info.exitCode = -1
      this.children.delete(info.id)
      this.reports.delete(info.id)
      onChange()
    })
    child.on('close', (code) => {
      info.state = 'exited'
      info.exitCode = code
      this.children.delete(info.id)
      this.reports.delete(info.id)
      onChange()
    })
    return info
  }

  /** pids of the running ones: the panel already lists these and their children */
  pids(): number[] {
    return [...this.children.values()].flatMap((c) => (c.pid ? [c.pid] : []))
  }

  /** the shell and everything under it, asked politely first; a failure goes to the process log */
  async stop(id: string): Promise<void> {
    const pid = this.children.get(id)?.pid
    if (!pid || this.stopping.has(id)) return
    this.stopping.add(id)
    try {
      // without a table only the shell is known; on Windows taskkill /T still finds the rest
      const snapshot = await createProcScanner(process.platform)({ terminals: new Map(), managed: [pid] }, true)
        .catch(() => ({ procs: [], ports: new Map<number, number[]>() }))
      if (!this.children.has(id)) return
      const result = await stopTree(pid, snapshot, systemDeps())
      if (!result.ok) this.reports.get(id)?.(result.error)
    } catch (e) {
      this.reports.get(id)?.(String(e))
    } finally {
      this.stopping.delete(id)
    }
  }

  stopAll(): void {
    for (const c of this.children.values()) killTree(c)
  }
}
