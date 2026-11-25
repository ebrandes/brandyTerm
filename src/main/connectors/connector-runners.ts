// The real login runners: a pty adapter over spawnPty for cli logins, the browser opener for oauth.
import { execFile } from 'node:child_process'
import { shell, type WebContents } from 'electron'
import { killTerminal, spawnPty } from '../terminal.ts'
import { runCliLogin, type CliLoginDeps } from './cli-login.ts'
import { makeOAuthRunner } from './oauth.ts'
import { loginPath } from './shell-path.ts'
import type { Runners } from './login.ts'
import type { SecretStore } from './secrets.ts'

/** The login terminal's screen is the renderer's xterm, so the window must exist when Entrar runs. */
export function ptyDeps(getWin: () => WebContents | undefined): CliLoginDeps {
  return {
    spawn: (id, o) => {
      const win = getWin()
      if (!win) throw new Error('A janela do BrandyTerm não está disponível.')
      spawnPty(win, id, { file: o.file, args: o.args, cwd: o.cwd, cols: 80, rows: 24, env: o.env, onExit: o.onExit })
      return { kill: () => killTerminal(id) }
    },
    exec: async cmd => {
      const PATH = await loginPath()
      return new Promise<number>(resolve => {
        execFile(cmd[0], cmd.slice(1), { env: { ...process.env, PATH }, timeout: 15_000 }, err => {
          resolve(err ? (typeof (err as NodeJS.ErrnoException).code === 'number' ? ((err as NodeJS.ErrnoException).code as unknown as number) : 1) : 0)
        })
      })
    },
  }
}

export function makeRunners(o: { getWin: () => WebContents | undefined; secrets: SecretStore }): Runners {
  const deps = ptyDeps(o.getWin)
  return {
    oauth: makeOAuthRunner({ secrets: o.secrets, open: url => shell.openExternal(url) }),
    cli: (c, terminalId, signal) => runCliLogin(c, terminalId, signal, deps),
    check: deps.exec,
  }
}
