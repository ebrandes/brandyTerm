import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' }
}

function sweep(dir: string, re: RegExp, me: number, isAlive: (pid: number) => boolean): void {
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return }
  for (const n of names) {
    const m = re.exec(n)
    if (!m || Number(m[1]) === me || isAlive(Number(m[1]))) continue
    try { fs.rmSync(join(dir, n), { force: true }) } catch { /* ignore */ }
  }
}

/** Removes gateway sockets left by earlier runs (see socketPath): gw-<pid>.sock in userData and the tmpdir fallback bt-gw-<pid>.sock. Skips pids still running. */
export function sweepStaleSockets(userData: string, me: number, tmp: string = tmpdir(), isAlive: (pid: number) => boolean = alive): void {
  if (process.platform === 'win32') return
  sweep(userData, /^gw-(\d+)\.sock$/, me, isAlive)
  sweep(tmp, /^bt-gw-(\d+)\.sock$/, me, isAlive)
}
