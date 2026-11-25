// The command a cli login or its check runs. On Windows an npm CLI is a .cmd shim that neither node-pty nor
// execFile can start, so resolveCli turns it into the real exe or `node script.js`. Elsewhere it runs as written.
import { resolveCli } from '../adapters/proc.ts'

export function resolveCommand(cmd: string[], path: string, platform: NodeJS.Platform = process.platform): string[] {
  const [name, ...args] = cmd
  if (platform !== 'win32' || !name) return cmd
  const found = resolveCli(name, { path, platform })
  // not found: the command stays as typed, and starting it fails naming it
  return found ? [found.cmd, ...found.prefix, ...args] : cmd
}

/** Runs a command and resolves with its exit code. */
export type ExecStatus = (file: string, args: string[], env: NodeJS.ProcessEnv) => Promise<number>

/** A login check (`railway whoami`) with the login PATH: its exit code. */
export function runCheck(cmd: string[], o: { path: string; exec: ExecStatus; platform?: NodeJS.Platform }): Promise<number> {
  const [file, ...args] = resolveCommand(cmd, o.path, o.platform)
  return o.exec(file, args, { ...process.env, PATH: o.path })
}
