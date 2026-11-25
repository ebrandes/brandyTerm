import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { AccountsState, ClaudeAccount } from '../shared/types.ts'
import type { ClaudeAuth, RateInfo } from './adapters/auth.ts'
import { resolveCli, spawnCli } from './adapters/proc.ts'
import { execFile } from 'node:child_process'

/**
 * Claude accounts BrandyTerm can bill. The CLI's own login is always there; extra
 * accounts are `claude setup-token` tokens, kept encrypted with the OS keychain
 * (safeStorage) and passed only to the child process as CLAUDE_CODE_OAUTH_TOKEN.
 * Sessions stay in ~/.claude, so chats and context survive a switch.
 */

/** switch before the hard stop: a run started at 99% would fail halfway */
const NEAR_LIMIT = 0.98

interface Saved {
  activeId: string
  autoSwitch: boolean
  list: (ClaudeAccount & { token?: string })[]
}

const now = () => Math.floor(Date.now() / 1000)

export class Accounts extends EventEmitter {
  state: AccountsState = { list: [{ id: 'login', label: 'Principal', kind: 'login' }], activeId: 'login', autoSwitch: true }
  private tokens = new Map<string, string>()
  private file = join(app.getPath('userData'), 'accounts.json')

  init(): void {
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Saved
      this.state.list = saved.list.map(({ token, ...a }) => {
        if (token) this.tokens.set(a.id, token)
        return { ...a, checking: false }
      })
      if (!this.state.list.some((a) => a.kind === 'login')) this.state.list.unshift({ id: 'login', label: 'Principal', kind: 'login' })
      this.state.activeId = this.state.list.some((a) => a.id === saved.activeId) ? saved.activeId : 'login'
      this.state.autoSwitch = saved.autoSwitch !== false
    } catch {
      // first run: only the CLI login
    }
    void this.detectPlan()
  }

  private save(): void {
    const list = this.state.list.map(({ checking: _c, ...a }) => ({ ...a, token: this.tokens.get(a.id) }))
    writeFileSync(this.file, JSON.stringify({ activeId: this.state.activeId, autoSwitch: this.state.autoSwitch, list } satisfies Saved, null, 2))
  }

  private changed(persist = true): void {
    if (persist) this.save()
    this.emit('change')
  }

  private get(id: string): ClaudeAccount | undefined {
    return this.state.list.find((a) => a.id === id)
  }

  private env(a: ClaudeAccount): Record<string, string | undefined> {
    const enc = this.tokens.get(a.id)
    if (a.kind !== 'token' || !enc) return {}
    try {
      return { CLAUDE_CODE_OAUTH_TOKEN: safeStorage.decryptString(Buffer.from(enc, 'base64')) }
    } catch {
      // keychain key changed (app renamed, other machine): the token is unreadable, ask for it again
      a.error = 'Não consegui ler o token salvo; remova e adicione a conta de novo'
      return {}
    }
  }

  private limited(a: ClaudeAccount): boolean {
    return (a.limitedUntil ?? 0) > now()
  }

  /** usable account with the most weekly room, other than `except` */
  private best(except: string): ClaudeAccount | undefined {
    return this.state.list
      .filter((a) => a.id !== except && !this.limited(a) && !a.error && (a.sevenDay?.utilization ?? 0) < NEAR_LIMIT)
      .sort((x, y) => (x.sevenDay?.utilization ?? 0) - (y.sevenDay?.utilization ?? 0))[0]
  }

  private switchTo(a: ClaudeAccount, auto: boolean): void {
    const from = this.get(this.state.activeId)
    this.state.activeId = a.id
    if (auto) this.state.lastSwitch = `Trocou de ${from?.label ?? '?'} para ${a.label} (limite) às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    this.changed()
  }

  auth(): ClaudeAuth {
    return {
      pick: () => {
        let a = this.get(this.state.activeId) ?? this.state.list[0]
        const other = this.state.autoSwitch && this.limited(a) ? this.best(a.id) : undefined
        if (other) {
          this.switchTo(other, true)
          a = other
        }
        let env = this.env(a)
        // an unreadable token would leave the run on the CLI login under this account's id
        if (a.kind === 'token' && !env.CLAUDE_CODE_OAUTH_TOKEN) {
          const fallback = this.best(a.id) ?? this.get('login') ?? this.state.list[0]
          this.switchTo(fallback, true)
          a = fallback
          env = this.env(a)
        }
        return { id: a.id, label: a.label, env }
      },
      report: (id, info) => this.report(id, info),
      failover: (id) => {
        const a = this.get(id)
        if (a && !this.limited(a)) a.limitedUntil = now() + 3600
        const next = this.state.autoSwitch ? this.best(id) : undefined
        if (next) this.switchTo(next, true)
        else this.changed()
        return next ? { label: next.label } : null
      }
    }
  }

  report(id: string, info: RateInfo): void {
    const a = this.get(id)
    if (!a) return
    const w = info.unifiedWindows ?? {}
    if (w.five_hour) a.fiveHour = { utilization: w.five_hour.utilization, resetsAt: w.five_hour.resetsAt }
    if (w.seven_day) a.sevenDay = { utilization: w.seven_day.utilization, resetsAt: w.seven_day.resetsAt }
    if (info.status === 'rejected') a.limitedUntil = info.resetsAt ?? now() + 3600
    else if (this.limited(a) && info.status?.startsWith('allowed')) a.limitedUntil = undefined
    a.checkedAt = new Date().toISOString()
    a.error = undefined
    const near = this.limited(a) || (a.fiveHour?.utilization ?? 0) >= NEAR_LIMIT || (a.sevenDay?.utilization ?? 0) >= NEAR_LIMIT
    const next = near && this.state.autoSwitch && id === this.state.activeId ? this.best(id) : undefined
    if (next) this.switchTo(next, true)
    else this.changed()
  }

  // ---- user actions -------------------------------------------------

  activate(id: string): void {
    const a = this.get(id)
    if (a) this.switchTo(a, false)
  }

  setAutoSwitch(on: boolean): void {
    this.state.autoSwitch = on
    this.changed()
  }

  rename(id: string, label: string): void {
    const a = this.get(id)
    if (!a || !label.trim()) return
    a.label = label.trim().slice(0, 40)
    this.changed()
  }

  remove(id: string): void {
    const a = this.get(id)
    if (!a || a.kind === 'login') return
    this.state.list = this.state.list.filter((x) => x.id !== id)
    this.tokens.delete(id)
    if (this.state.activeId === id) this.state.activeId = 'login'
    this.changed()
  }

  addToken(label: string, token: string): ClaudeAccount {
    const t = token.trim()
    if (!/^sk-ant-[\w-]{20,}$/.test(t)) throw new Error('Token inválido: deve começar com sk-ant-')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('O sistema não oferece armazenamento seguro para o token')
    const a: ClaudeAccount = { id: randomUUID(), label: label.trim().slice(0, 40) || 'Outra conta', kind: 'token' }
    this.tokens.set(a.id, safeStorage.encryptString(t).toString('base64'))
    this.state.list.push(a)
    this.changed()
    void this.probe(a.id)
    return a
  }

  /** A one-word Haiku run to read the account's limits (costs a few cached tokens). */
  async probe(id: string): Promise<void> {
    const a = this.get(id)
    const cli = resolveCli('claude')
    if (!a || !cli || a.checking) return
    a.checking = true
    this.changed(false)
    const dir = join(app.getPath('userData'), 'probe')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const env: NodeJS.ProcessEnv = { ...process.env, ...this.env(a) }
    if (a.kind === 'login') delete env.CLAUDE_CODE_OAUTH_TOKEN
    let err: string | undefined
    let seen = false
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project', '--tools', '', '--strict-mcp-config', '--model', 'haiku']
    await spawnCli(cli, args, {
      cwd: dir,
      env,
      input: 'Responda apenas: ok',
      onLine: (line) => {
        try {
          const ev = JSON.parse(line)
          if (ev.type === 'rate_limit_event' && ev.rate_limit_info) {
            seen = true
            this.report(id, ev.rate_limit_info)
          } else if (ev.type === 'result' && ev.is_error) err = String(ev.result ?? 'erro')
        } catch {
          // not JSON
        }
      }
    }).done
    a.checking = false
    if (err && !seen) a.error = /401|invalid|authenticate/i.test(err) ? 'Token inválido ou expirado' : err.slice(0, 120)
    a.checkedAt = new Date().toISOString()
    this.changed()
  }

  /** plan of the CLI login, from `claude auth status` (shown next to the account) */
  private detectPlan(): Promise<void> {
    const cli = resolveCli('claude')
    if (!cli) return Promise.resolve()
    const env = { ...process.env }
    delete env.CLAUDE_CODE_OAUTH_TOKEN
    return new Promise((resolve) => {
      execFile(cli.cmd, [...cli.prefix, 'auth', 'status', '--json'], { env, timeout: 15000, windowsHide: true }, (e, out) => {
        try {
          const s = JSON.parse(out)
          const login = this.get('login')
          if (login && s.loggedIn) login.plan = String(s.planTier ?? s.subscriptionType ?? '').replace(/_/g, ' ') || undefined
          this.changed(false)
        } catch {
          // not logged in or old CLI
        }
        resolve()
      })
    })
  }
}
