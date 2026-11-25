// The real login runners: a pty adapter over spawnPty for cli logins, the browser opener for oauth.
import { execFile } from 'node:child_process'
import { shell, type WebContents } from 'electron'
import { killTerminal, spawnPty } from '../terminal.ts'
import { runCliLogin, type CliLoginDeps } from './cli-login.ts'
import { makeOAuthRunner } from './oauth.ts'
import { loginUrlProblem } from './login-url.ts'
import { loginPath } from './shell-path.ts'
import { runCheck, type ExecStatus } from './cli-command.ts'
import type { Runners } from './login.ts'
import type { SecretStore } from './secrets.ts'

/** The exit code of a command; a failure to start counts as 1. */
const execStatus: ExecStatus = (file, args, env) =>
  new Promise<number>(resolve => {
    execFile(file, args, { env, timeout: 15_000 }, err => {
      resolve(err ? (typeof (err as NodeJS.ErrnoException).code === 'number' ? ((err as NodeJS.ErrnoException).code as unknown as number) : 1) : 0)
    })
  })

/** The login terminal's screen is the renderer's xterm, so the window must exist when Entrar runs. */
export function ptyDeps(getWin: () => WebContents | undefined): CliLoginDeps {
  return {
    spawn: (id, o) => {
      const win = getWin()
      if (!win) throw new Error('A janela do BrandyTerm não está disponível.')
      spawnPty(win, id, { file: o.file, args: o.args, cwd: o.cwd, cols: 80, rows: 24, env: o.env, onExit: o.onExit })
      return { kill: () => killTerminal(id) }
    },
    exec: async cmd => runCheck(cmd, { path: await loginPath(), exec: execStatus }),
  }
}

export function makeRunners(o: { getWin: () => WebContents | undefined; secrets: SecretStore }): Runners {
  const deps = ptyDeps(o.getWin)
  return {
    oauth: makeOAuthRunner({
      secrets: o.secrets,
      // the runner already refused anything else; checked again right where the OS gets the URL
      open: url => {
        const bad = loginUrlProblem(url)
        if (bad) throw new Error(bad)
        return shell.openExternal(url)
      },
    }),
    cli: (c, terminalId, signal) => runCliLogin(c, terminalId, signal, deps),
    check: deps.exec,
  }
}
