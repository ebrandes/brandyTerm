/**
 * Reads the system's processes and listening TCP ports. Runs only when asked (nothing ticks here),
 * one scan at a time, cached. It only reads: nothing here signals a process.
 */
import { execFile } from 'node:child_process'
import { candidatePids, type OwnedPids, type ProcSnapshot } from '../shared/proc-attribution.ts'
import { parseLsofCwds, parseLsofPorts, parsePs, parseWindows } from './proc-scan-parse.ts'

export type Run = (file: string, args: string[]) => Promise<string>

/** just under the renderer's 5s poll; PowerShell costs several hundred ms, so Windows waits longer */
const TTL_UNIX = 4_000
const TTL_WINDOWS = 10_000
/** a cold PowerShell may take several seconds to load its modules */
const TIMEOUT = process.platform === 'win32' ? 9_000 : 4_000

const WINDOWS_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
  '$ports=@(Get-NetTCPConnection -State Listen | Select-Object LocalPort,OwningProcess)',
  '$procs=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine)',
  '@{ports=$ports;procs=$procs} | ConvertTo-Json -Compress -Depth 3'
].join(';')

const execRun: Run = (file, args) =>
  new Promise((resolve, reject) => {
    // a UTF-8 locale: under "C", lsof and ps mangle accented folder names
    const env = { ...process.env, LC_ALL: process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8' }
    execFile(file, args, { timeout: TIMEOUT, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env }, (err, stdout) => {
      // lsof exits with 1 when it finds nothing or a listed pid died: what it printed still holds
      if (err && (err.killed || typeof err.code !== 'number')) reject(err)
      else resolve(stdout)
    })
  })

export function createProcScanner(platform: string, run: Run = execRun, now: () => number = Date.now) {
  const ttl = platform === 'win32' ? TTL_WINDOWS : TTL_UNIX
  /** a server keeps its folder: asked once per pid (the command guards against a reused pid) */
  const cwds = new Map<number, { command: string; cwd: string | undefined }>()
  let last: ProcSnapshot = { procs: [], ports: new Map() }
  let at = -Infinity
  let pending: Promise<ProcSnapshot> | null = null

  async function fillCwds(snapshot: ProcSnapshot, owned: OwnedPids): Promise<void> {
    const byPid = new Map(snapshot.procs.map((p) => [p.pid, p]))
    for (const [pid, seen] of cwds) if (byPid.get(pid)?.command !== seen.command) cwds.delete(pid)
    const candidates = candidatePids(snapshot, owned)
    const missing = [...new Set(candidates)].filter((pid) => !cwds.has(pid))
    if (missing.length) {
      const found = parseLsofCwds(await run('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', missing.join(',')]))
      // nothing at all may be lsof failing: remember nothing, ask again next time
      if (found.size) for (const pid of missing) cwds.set(pid, { command: byPid.get(pid)!.command, cwd: found.get(pid) })
    }
    for (const pid of candidates) byPid.get(pid)!.cwd = cwds.get(pid)?.cwd
  }

  async function read(owned: OwnedPids): Promise<ProcSnapshot> {
    if (platform === 'win32') {
      return parseWindows(await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT]))
    }
    const [listening, table] = await Promise.all([
      run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']),
      run('ps', ['-axww', '-o', 'pid=,ppid=,pgid=,tpgid=,command='])
    ])
    const snapshot = { procs: parsePs(table), ports: parseLsofPorts(listening) }
    if (!snapshot.procs.length) throw new Error('ps não listou nada')
    await fillCwds(snapshot, owned)
    return snapshot
  }

  return (owned: OwnedPids): Promise<ProcSnapshot> => {
    if (pending) return pending
    if (now() - at < ttl) return Promise.resolve(last)
    pending = read(owned)
      .then((snapshot) => (last = snapshot), () => last)
      .finally(() => {
        at = now()
        pending = null
      })
    return pending
  }
}
