// At app start, connects every enabled connector again, so the panel is as the user left it without any click.
// The status lives only in memory: without this, all of them start disconnected after a restart.
import type { Connector } from '../../shared/connectors.ts'
import { connectorProblem } from '../../shared/connector-problem.ts'
import type { mcpLog } from './connect-diag.ts'
import { ConnectorError, type ConnectorHub } from './hub.ts'
import type { LoginBroker } from './login.ts'
import type { ConnectorStore } from './store.ts'

export interface ReconnectDeps {
  store: Pick<ConnectorStore, 'list' | 'get'>
  hub: Pick<ConnectorHub, 'test' | 'markLogin'>
  login: Pick<LoginBroker, 'needsLogin'>
  log: typeof mcpLog
  /** waits between the tries of an http connector; a network blip must not leave it down */
  retryDelays?: number[]
  /** aborted when the app is quitting: no more tries */
  signal?: AbortSignal
}

export const RETRY_DELAYS_MS = [2_000, 10_000]

/** false when the app quit during the wait */
function pause(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve(false)
    const done = (go: boolean): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', quit)
      resolve(go)
    }
    const quit = (): void => done(false)
    const timer = setTimeout(() => done(true), ms)
    timer.unref?.()
    signal?.addEventListener('abort', quit, { once: true })
  })
}

/** Tests it, trying an http one again after each wait while it is still switched on. */
async function connect({ store, hub, log, signal, retryDelays = RETRY_DELAYS_MS }: ReconnectDeps, id: string): Promise<void> {
  const waits = [...retryDelays]
  for (;;) {
    // checks and waits take time: the user may have switched it off or removed it meanwhile
    const now = store.get(id)
    if (!now?.enabled || signal?.aborted) return
    try {
      const tools = await hub.test(now)
      log('info', 'reconexão no início ok', now, { tools })
      return
    } catch (e) {
      const login = e instanceof ConnectorError && e.kind === 'login'
      // a stdio command that failed fails again the same way
      const wait = !login && now.transport === 'http' ? waits.shift() : undefined
      if (wait === undefined) throw e
      log('warn', 'reconexão no início vai tentar de novo', now, { ms: wait, error: e instanceof Error ? e.message : String(e) })
      if (!(await pause(wait, signal))) return
    }
  }
}

async function reconnect(d: ReconnectDeps, c: Connector): Promise<void> {
  const { hub, login, log } = d
  try {
    if (await login.needsLogin(c)) {
      hub.markLogin(c.id)
      log('info', 'reconexão no início aguarda login', c)
      return
    }
    await connect(d, c.id)
  } catch (e) {
    // the hub keeps the status and its message for the panel
    log('warn', 'reconexão no início falhou', c, { error: e instanceof Error ? e.message : String(e) })
  }
}

/** All at once, each try within the hub's test deadline. Never rejects. Never opens a browser. */
export async function reconnectEnabled(d: ReconnectDeps): Promise<void> {
  await Promise.all(d.store.list().filter(c => c.enabled && !connectorProblem(c)).map(c => reconnect(d, c)))
}
