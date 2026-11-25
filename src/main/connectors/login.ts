// Login broker: one card per connector that needs a login. Nothing runs until Entrar; Cancelar or the hold timeout releases every waiting thread with an error.
import { EventEmitter } from 'node:events'
import type { Connector, PanelLogin, ThreadLogin, ThreadRef, TokenField } from '../../shared/connectors.ts'
import type { ConnectorHub } from './hub.ts'
import type { ConnectorStore } from './store.ts'
import type { SecretStore } from './secrets.ts'
import { cancelledMessage } from './cli-login.ts'

export const HOLD_MS = 900_000

export interface Runners {
  oauth(c: Connector, signal: AbortSignal): Promise<void>
  cli(c: Connector, terminalId: string, signal: AbortSignal): Promise<void>
  /** exit code of a cli connector's `auth.check` */
  check(command: string[]): Promise<number>
}

export interface LoginDeps {
  store: ConnectorStore
  secrets: SecretStore
  hub: Pick<ConnectorHub, 'test' | 'markLogin'>
  runners: Runners
  holdMs?: number
}

interface Waiter { ref: ThreadRef; resolve(): void; reject(e: Error): void; off(): void }
interface Card {
  c: Connector
  phase: PanelLogin['phase']
  error?: string
  panel: boolean
  waiters: Waiter[]
  run?: AbortController
  timer?: NodeJS.Timeout
}

export const loginTerminalId = (connectorId: string): string => `connector-login-${connectorId}`

const fieldsOf = (c: Connector): TokenField[] => (c.auth.kind === 'token' ? c.auth.fields : [])

export class LoginBroker extends EventEmitter {
  private readonly deps: LoginDeps
  private readonly cards = new Map<string, Card>()

  constructor(deps: LoginDeps) {
    super()
    this.deps = deps
  }

  async needsLogin(c: Connector): Promise<boolean> {
    const a = c.auth
    if (a.kind === 'none') return false
    const s = this.deps.secrets.get(c.id)
    if (a.kind === 'oauth') return !s.oauth?.tokens
    if (a.kind === 'token') return a.fields.some(f => ('header' in f.use ? !s.headers?.[f.use.header] : !s.env?.[f.use.env]))
    return a.check ? (await this.deps.runners.check(a.check)) !== 0 : false
  }

  private card(c: Connector, panel: boolean): Card {
    let card = this.cards.get(c.id)
    if (!card) this.cards.set(c.id, (card = { c, phase: 'ask', panel, waiters: [] }))
    else card.panel ||= panel
    return card
  }

  ask(c: Connector): void {
    this.card(c, true)
    this.emit('change')
  }

  require(c: Connector, ref: ThreadRef, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new Error(cancelledMessage(c.name)))
    const card = this.card(c, false)
    card.timer ??= this.arm(c.id)
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        this.drop(card, w)
        reject(new Error(cancelledMessage(c.name)))
      }
      const w: Waiter = { ref, resolve, reject, off: () => signal.removeEventListener('abort', onAbort) }
      signal.addEventListener('abort', onAbort, { once: true })
      card.waiters.push(w)
      this.emit('change')
    })
  }

  private arm(id: string): NodeJS.Timeout {
    const t = setTimeout(() => this.cancel(id), this.deps.holdMs ?? HOLD_MS)
    t.unref?.()
    return t
  }

  /** a waiting thread gave up; a card nobody else asked for goes with it unless a login is running */
  private drop(card: Card, w: Waiter): void {
    card.waiters = card.waiters.filter(x => x !== w)
    if (!card.waiters.length && !card.panel && !card.run && this.cards.get(card.c.id) === card) this.close(card)
    this.emit('change')
  }

  private close(card: Card): void {
    if (card.timer) clearTimeout(card.timer)
    card.timer = undefined
    if (this.cards.get(card.c.id) === card) this.cards.delete(card.c.id)
  }

  async enter(id: string, values?: Record<string, string>): Promise<void> {
    const card = this.cards.get(id)
    if (!card || card.phase === 'waiting') return
    const c = this.deps.store.get(id) ?? card.c
    card.c = c
    card.phase = 'waiting'
    card.error = undefined
    const run = (card.run = new AbortController())
    this.emit('change')
    try {
      if (c.auth.kind === 'token') this.saveFields(c, values ?? {})
      else if (c.auth.kind === 'oauth') await this.deps.runners.oauth(c, run.signal)
      else if (c.auth.kind === 'cli') await this.deps.runners.cli(c, loginTerminalId(id), run.signal)
      if (run.signal.aborted) return
      await this.deps.hub.test(c)
    } catch (e) {
      if (run.signal.aborted || this.cards.get(id) !== card) return
      card.run = undefined
      card.phase = 'failed'
      card.error = e instanceof Error ? e.message : String(e)
      this.deps.hub.markLogin(id)
      return void this.emit('change')
    }
    if (run.signal.aborted || this.cards.get(id) !== card) return
    this.close(card)
    this.release(card, w => w.resolve())
  }

  private saveFields(c: Connector, values: Record<string, string>): void {
    const prev = this.deps.secrets.get(c.id)
    const headers = { ...prev.headers }
    const env = { ...prev.env }
    for (const f of fieldsOf(c)) {
      const v = (values[f.key] ?? '').trim()
      if (!v) throw new Error(`Preencha ${f.label}.`)
      if ('header' in f.use) headers[f.use.header] = f.use.format.replace('{value}', v)
      else env[f.use.env] = v
    }
    this.deps.secrets.patch(c.id, { headers, env })
  }

  cancel(id: string): void {
    const card = this.cards.get(id)
    if (!card) return
    card.run?.abort()
    this.close(card)
    this.deps.hub.markLogin(id)
    this.release(card, w => w.reject(new Error(cancelledMessage(card.c.name))))
  }

  private release(card: Card, settle: (w: Waiter) => void): void {
    const ws = card.waiters
    card.waiters = []
    for (const w of ws) { w.off(); settle(w) }
    this.emit('change')
  }

  private view(card: Card): PanelLogin {
    const { c } = card
    return {
      connectorId: c.id,
      name: c.name,
      phase: card.phase,
      authKind: c.auth.kind,
      ...(card.error ? { error: card.error } : {}),
      ...(c.auth.kind === 'token' ? { fields: c.auth.fields.map(f => ({ key: f.key, label: f.label })) } : {}),
      ...(c.auth.kind === 'cli' ? { terminalId: loginTerminalId(c.id) } : {}),
    }
  }

  panelLogins(): PanelLogin[] {
    return [...this.cards.values()].map(card => this.view(card))
  }

  threadLogins(threadId: string): ThreadLogin[] {
    return [...this.cards.values()].filter(card => card.waiters.some(w => w.ref.threadId === threadId)).map(card => this.view(card))
  }
}
