// "cli" logins (railway login...): the command runs in a pty the user sees and types into; success is its exit plus the optional check.
import os from 'node:os'
import type { Connector } from '../../shared/connectors.ts'
import { loginPath } from './shell-path.ts'
import { resolveCommand } from './cli-command.ts'

export interface CliLoginDeps {
  spawn: (id: string, o: { file: string; args: string[]; cwd: string; env?: Record<string, string>; onExit: (code: number) => void }) => { kill(): void }
  exec: (cmd: string[]) => Promise<number>
  /** PATH for the login command; defaults to the login shell's */
  path?: () => Promise<string>
  /** defaults to this process's; tests run the Windows resolution anywhere */
  platform?: NodeJS.Platform
}

export const cancelledMessage = (name: string): string => `login do ${name} cancelado`

function missing(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException)?.code
  return code === 'ENOENT' || /ENOENT|not found|posix_spawnp/i.test(e instanceof Error ? e.message : String(e))
}

export async function runCliLogin(c: Connector, terminalId: string, signal: AbortSignal, deps: CliLoginDeps): Promise<void> {
  if (c.auth.kind !== 'cli') throw new Error(`${c.name} não usa login por CLI`)
  const { command, check } = c.auth
  const name = command[0]
  if (signal.aborted) throw new Error(cancelledMessage(c.name))
  const PATH = await (deps.path ?? loginPath)()
  // on Windows an npm CLI is a .cmd shim the pty cannot start: run its real exe or script
  const [file, ...args] = resolveCommand(command, PATH, deps.platform)
  let onAbort = () => {}
  const code = await new Promise<number>((resolve, reject) => {
    let handle: { kill(): void } | undefined
    onAbort = () => { handle?.kill(); reject(new Error(cancelledMessage(c.name))) }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) return onAbort()
    try {
      handle = deps.spawn(terminalId, { file, args, cwd: os.homedir(), env: { PATH }, onExit: resolve })
    } catch (e) {
      reject(missing(e) ? new Error(`Comando ${name} não encontrado. Instale o CLI e tente de novo.`) : e)
    }
  }).finally(() => signal.removeEventListener('abort', onAbort))
  if (code !== 0) throw new Error(`Login do ${c.name} não terminou`)
  if (check && (await deps.exec(check)) !== 0) throw new Error(`Login do ${c.name} não foi confirmado`)
}
