import type { WebContents } from 'electron'
import { registry } from './rpc/registry.ts'
import { ruleOf } from './rpc/channels.ts'
import { homedir } from 'node:os'
import type { Accounts } from './accounts.ts'
import { resolveCli } from './adapters/proc.ts'
import { killTerminal, spawnPty } from './terminal.ts'

/** id of the pty (and renderer xterm) that runs `claude setup-token` */
export const LOGIN_TERM = 'account-login'
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g
/** the token counts only once something follows it: a chunk may end in the middle of it */
const TOKEN = /sk-ant-oat\d+-[A-Za-z0-9_-]{20,}(?=\s)/

/**
 * Account IPC. Adding an account runs `claude setup-token` in a pty shown in the
 * renderer: the browser asks for the claude.ai login, the CLI prints a long-lived
 * token, and the token is captured from the output and stored encrypted.
 */
export function registerAccountIpc(accounts: Accounts): void {
  registry.add('accounts:activate', (id: string) => accounts.activate(String(id)), ruleOf('accounts:activate'))
  registry.add('accounts:auto', (on: boolean) => accounts.setAutoSwitch(!!on), ruleOf('accounts:auto'))
  registry.add('accounts:rename', (a: { id: string; label: string }) => accounts.rename(String(a.id), String(a.label ?? '')), ruleOf('accounts:rename'))
  registry.add('accounts:remove', (id: string) => accounts.remove(String(id)), ruleOf('accounts:remove'))
  registry.add('accounts:probe', (id: string) => accounts.probe(String(id)), ruleOf('accounts:probe'))
  registry.add('accounts:add-token', (a: { label: string; token: string }) => {
    accounts.addToken(String(a.label ?? ''), String(a.token ?? ''))
  }, ruleOf('accounts:add-token'))

  registry.add('accounts:login-start', (a: { label: string; rows: number }, ctx) => {
    const cli = resolveCli('claude')
    if (!cli) throw new Error('Claude Code não encontrado no PATH')
    const label = String(a.label ?? '').trim() || 'Outra conta'
    killTerminal(LOGIN_TERM)
    accounts.state.login = { label }
    accounts.emit('change')
    let out = ''
    let saved = false
    spawnPty(ctx.sender as WebContents, LOGIN_TERM, {
      file: cli.cmd,
      args: [...cli.prefix, 'setup-token'],
      cwd: homedir(),
      // wide enough that the CLI never wraps the token across lines
      cols: 400,
      rows: Number(a.rows) || 24,
      fixedCols: true,
      // the new token must come from the browser login, not from an env token
      env: { CLAUDE_CODE_OAUTH_TOKEN: undefined },
      onData: (data) => {
        if (saved) return
        out = (out + data.replace(ANSI, '')).slice(-8000)
        const m = TOKEN.exec(out)
        if (!m) return
        saved = true
        try {
          accounts.addToken(label, m[0])
          accounts.state.login = undefined
        } catch (err) {
          accounts.state.login = { label, error: (err as Error).message }
        }
        accounts.emit('change')
        setTimeout(() => killTerminal(LOGIN_TERM), 800)
      },
      onExit: () => {
        if (!saved && accounts.state.login) {
          accounts.state.login = { label, error: 'O login terminou sem token. Tente de novo ou cole o token.' }
          accounts.emit('change')
        }
      }
    })
  }, ruleOf('accounts:login-start'))

  registry.add('accounts:login-cancel', () => {
    accounts.state.login = undefined
    killTerminal(LOGIN_TERM)
    accounts.emit('change')
  }, ruleOf('accounts:login-cancel'))
}
