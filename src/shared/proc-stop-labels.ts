import type { ProcessInfo } from './types.ts'

export type StopResult = { ok: true; forced: boolean } | { ok: false; error: string }

/** a "+" process also carries the pid it runs under, which the confirmation shows */
export type RunningProcess = ProcessInfo & { pid?: number }

/** The texts of stopping a process; `platform` is process.platform of the machine that runs it (pure). */

const portList = (ports: number[]): string => ports.map((p) => `:${p}`).join(' ')

/** "Parar Astro preview (PID 17948, :4321)?" */
export function stopQuestion(name: string, pid: number | undefined, ports: number[]): string {
  const detail = [pid === undefined ? '' : `PID ${pid}`, portList(ports)].filter(Boolean).join(', ')
  return `Parar ${name}${detail ? ` (${detail})` : ''}?`
}

export function stopHint(platform: string | undefined): string {
  if (platform === 'win32') return 'Encerra também os processos filhos (taskkill /T). Força com /F só se preciso.'
  if (platform === 'darwin' || platform === 'linux') {
    return 'Encerra também os processos filhos (SIGTERM). Se não saírem em alguns segundos, SIGKILL.'
  }
  return 'Encerra também os processos filhos.'
}
