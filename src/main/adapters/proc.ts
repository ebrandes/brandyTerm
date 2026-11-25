import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface ResolvedCli {
  cmd: string
  prefix: string[]
}

const isWin = process.platform === 'win32'

/**
 * On Windows `claude`/`codex` are .cmd shims. Spawning them needs a shell, which breaks
 * quoting of JSON args. Read the shim and spawn the real exe / node script directly.
 * `path` and `platform` default to this process's.
 */
export function resolveCli(name: string, o: { path?: string; platform?: NodeJS.Platform } = {}): ResolvedCli | null {
  const win = (o.platform ?? process.platform) === 'win32'
  const dirs = (o.path ?? process.env.PATH ?? process.env.Path ?? '').split(win ? ';' : ':').filter(Boolean)
  if (!win) {
    for (const d of dirs) if (existsSync(join(d, name))) return { cmd: join(d, name), prefix: [] }
    return null
  }
  for (const d of dirs) {
    const exe = join(d, `${name}.exe`)
    if (existsSync(exe)) return { cmd: exe, prefix: [] }
    const shim = join(d, `${name}.cmd`)
    if (!existsSync(shim)) continue
    const text = readFileSync(shim, 'utf8')
    const matches = [...text.matchAll(/"([^"\r\n]*?\.(?:exe|js))"/gi)].map((m) => m[1])
    const target = matches[matches.length - 1]
    if (!target) continue
    const real = target.replace(/%dp0%\\?/gi, dirname(shim) + '\\')
    if (!existsSync(real)) continue
    if (real.toLowerCase().endsWith('.js')) {
      const bundledNode = join(dirname(shim), 'node.exe')
      return { cmd: existsSync(bundledNode) ? bundledNode : 'node', prefix: [real] }
    }
    return { cmd: real, prefix: [] }
  }
  return null
}

const live = new Set<ChildProcess>()

type Run = (cmd: string, args: string[]) => void
const runQuiet: Run = (cmd, args) => {
  spawn(cmd, args, { stdio: 'ignore', windowsHide: true }).on('error', () => {})
}

/** Kills a process by pid. On Windows the whole tree: the child of a cmd.exe or npx wrapper would outlive a plain kill. */
export function killPidTree(pid: number, platform: NodeJS.Platform = process.platform, run: Run = runQuiet): void {
  if (platform === 'win32') run('taskkill', ['/pid', String(pid), '/T', '/F'])
  else process.kill(pid)
}

export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return
  if (isWin) {
    killPidTree(child.pid, 'win32')
  } else {
    child.kill('SIGTERM')
  }
}

export function trackChild(child: ChildProcess): void {
  live.add(child)
  child.on('close', () => live.delete(child))
}

export function killAll(): void {
  for (const c of live) killTree(c)
}

export interface SpawnOpts {
  cwd: string
  input: string
  /** full environment for the child; defaults to the app's */
  env?: NodeJS.ProcessEnv
  onLine: (line: string) => void
}

export interface Running {
  done: Promise<{ code: number | null; stderr: string; cancelled: boolean }>
  cancel: () => void
}

export function spawnCli(cli: ResolvedCli, args: string[], opts: SpawnOpts): Running {
  const child = spawn(cli.cmd, [...cli.prefix, ...args], {
    cwd: opts.cwd,
    env: opts.env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  live.add(child)
  let cancelled = false
  let buf = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (d: string) => {
    buf += d
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line) opts.onLine(line)
    }
  })
  child.stderr.on('data', (d: string) => {
    stderr = (stderr + d).slice(-4000)
  })
  child.stdin.on('error', () => {})
  child.stdin.end(opts.input)
  const done = new Promise<{ code: number | null; stderr: string; cancelled: boolean }>((resolve) => {
    child.on('error', (e) => {
      live.delete(child)
      resolve({ code: -1, stderr: String(e), cancelled })
    })
    child.on('close', (code) => {
      live.delete(child)
      if (buf.trim()) opts.onLine(buf.trim())
      resolve({ code, stderr, cancelled })
    })
  })
  return {
    done,
    cancel: () => {
      cancelled = true
      killTree(child)
    }
  }
}
