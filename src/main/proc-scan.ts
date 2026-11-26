/**
 * Reads the system's processes and listening TCP ports. Runs only when asked (nothing ticks here),
 * one scan at a time, cached. It only reads: signaling is proc-stop.ts's job.
 */
import { execFile } from 'node:child_process'
import { candidatePids, type OwnedPids, type ProcSnapshot } from '../shared/proc-attribution.ts'
import { parseLsofCwds, parseLsofPorts, parsePs, parsePsStarts, parseWindows } from './proc-scan-parse.ts'

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
  // creation time as epoch ms: ConvertTo-Json writes dates differently on each PowerShell
  "$started=@{n='Started';e={if($_.CreationDate){[DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds()}else{$null}}}",
  '$procs=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,$started)',
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
  /** a server keeps its folder and start time: asked once per pid (the command guards against a reused pid) */
  const known = new Map<number, { command: string; cwd: string | undefined; startedAt: number | undefined }>()
  let last: ProcSnapshot = { procs: [], ports: new Map() }
  let at = -Infinity
  let pending: Promise<ProcSnapshot> | null = null

  async function fillDetails(snapshot: ProcSnapshot, owned: OwnedPids): Promise<void> {
    const byPid = new Map(snapshot.procs.map((p) => [p.pid, p]))
    for (const [pid, seen] of known) if (byPid.get(pid)?.command !== seen.command) known.delete(pid)
    const candidates = [...new Set(candidatePids(snapshot, owned))]
    const missing = candidates.filter((pid) => !known.has(pid))
    let starts = new Map<number, number>()
    if (missing.length) {
      const list = missing.join(',')
      const [cwdOut, startOut] = await Promise.all([
        run('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', list]),
        // the start time is only information: without it the list still holds
        run('ps', ['-o', 'pid=,lstart=', '-p', list]).catch(() => '')
      ])
      const cwds = parseLsofCwds(cwdOut)
      starts = parsePsStarts(startOut)
      // no folder at all may be lsof failing: remember nothing, ask again next time
      if (cwds.size) {
        for (const pid of missing) known.set(pid, { command: byPid.get(pid)!.command, cwd: cwds.get(pid), startedAt: starts.get(pid) })
      }
    }
    for (const pid of candidates) {
      const entry = byPid.get(pid)!
      entry.cwd = known.get(pid)?.cwd
      const startedAt = known.get(pid)?.startedAt ?? starts.get(pid)
      if (startedAt !== undefined) entry.startedAt = startedAt
    }
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
    await fillDetails(snapshot, owned)
    return snapshot
  }

  function begin(owned: OwnedPids): Promise<ProcSnapshot> {
    const reading = read(owned)
      .then((snapshot) => (last = snapshot))
      .finally(() => {
        at = now()
        pending = null
      })
    pending = reading
    return reading
  }

  /** `fresh` (before signaling a pid): a read that starts now and fails loudly instead of answering with an old one */
  return async (owned: OwnedPids, fresh = false): Promise<ProcSnapshot> => {
    if (fresh) {
      while (pending) await pending.catch(() => {})
      known.clear()
      return begin(owned)
    }
    if (pending) return pending.catch(() => last)
    if (now() - at < ttl) return last
    return begin(owned).catch(() => last)
  }
}
