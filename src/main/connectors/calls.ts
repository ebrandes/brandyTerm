// What the gateway's three tools do in main: list, tools and call, with login and approval holds under one deadline.
import type { Connector, ThreadRef } from '../../shared/connectors.ts'
import type { ApprovalDecision, Project, Thread } from '../../shared/types.ts'
import type { ApprovalAsk } from '../adapters/types.ts'
import type { GwHandler } from './gateway-server.ts'
import { ConnectorError, LOGIN_NEEDED, type ConnectorHub } from './hub.ts'
import type { LoginBroker } from './login.ts'
import type { ConnectorStore } from './store.ts'
import { HOLD_MS } from './login.ts'
import { resultText, toolsText } from './result-text.ts'
import { CANCELLED, hold, startDeadline, type Deadline } from './deadline.ts'

export { RESULT_CAP } from './result-text.ts'
const DETAIL_CAP = 8000

/** The arguments as the approval card shows them; when cut, a visible line says so, so nothing hides past the end. */
function detailOf(args: unknown): string {
  const full = JSON.stringify(args ?? {}, null, 2) ?? '{}'
  return full.length <= DETAIL_CAP ? full : `${full.slice(0, DETAIL_CAP)}\n(argumentos cortados: ${DETAIL_CAP} de ${full.length} caracteres)`
}

export interface CallsDeps {
  store: Pick<ConnectorStore, 'list' | 'visibleFor' | 'allow'>
  hub: Pick<ConnectorHub, 'tools' | 'call'>
  login: Pick<LoginBroker, 'needsLogin' | 'require'>
  approvals: {
    ask(t: Thread, a: ApprovalAsk): Promise<ApprovalDecision>
    /** release the other pending cards for a connector tool the user allowed for good */
    releaseConnector(connectorId: string, tool: string): void
  }
  findThread(r: ThreadRef): { p: Project; t: Thread } | undefined
  machineName(): string
  /** name of an online machine that has a connector with this name */
  elsewhere(name: string): string | undefined
  notify(r: ThreadRef, text: string): void
  holdMs?: number
}

export function createCalls(d: CallsDeps): GwHandler {
  const holdMs = d.holdMs ?? HOLD_MS

  /** the connector a thread may use, or the reason it may not */
  function resolve(ref: ThreadRef, p: Project, name: string | undefined): Connector {
    if (!name) throw new Error('Informe o nome do conector')
    const lower = name.toLowerCase()
    const c = d.store.list().find(x => x.name.toLowerCase() === lower)
    if (!c) {
      const other = d.elsewhere(name)
      const here = d.machineName()
      const msg = other
        ? `${name} não está instalado em ${here}; está em ${other}. Instale pelo painel Conectores em ${here}.`
        : `${name} não está instalado em ${here}. Instale pelo painel Conectores.`
      d.notify(ref, msg)
      throw new Error(msg)
    }
    if (!c.enabled) throw new Error(`${c.name} está desativado no painel Conectores.`)
    if (c.projects && !c.projects.includes(p.path ?? '')) throw new Error(`${c.name} não está liberado para este projeto.`)
    return c
  }

  /** the connector as it is now: removed or turned off while the call waited means it must not run */
  function still(c: Connector): Connector {
    const now = d.store.list().find(x => x.id === c.id)
    if (!now) throw new Error(`${c.name} foi removido.`)
    if (!now.enabled) throw new Error(`${c.name} está desativado.`)
    return now
  }

  async function approve(c: Connector, t: Thread, tool: string, args: unknown, dl: Deadline): Promise<void> {
    if (c.alwaysAllow.includes(tool)) return
    const detail = detailOf(args)
    const input = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
    const answer = await hold(
      s => d.approvals.ask(t, { tool: `mcp__${c.id}__${tool}`, input, summary: `${c.name} · ${tool}`, detail, connector: { id: c.id, name: c.name, tool }, signal: s }),
      dl,
    )
    if (answer === 'deny') throw new Error('Chamada negada pelo usuário')
    if (answer === 'forever') {
      d.store.allow(c.id, tool)
      d.approvals.releaseConnector(c.id, tool)
    }
  }

  /**
   * Runs `fn` on the connector as it is now. The first time in a request that the connector refuses its
   * credentials, the login card shows (within the deadline) and `fn` runs once more; a second refusal fails.
   */
  async function withLogin<T>(c: Connector, ref: ThreadRef, dl: Deadline, retry: { used: boolean }, fn: (c: Connector) => Promise<T>): Promise<T> {
    try {
      return await fn(still(c))
    } catch (e) {
      if (!(e instanceof ConnectorError && e.kind === 'login')) throw e
      if (retry.used) throw new Error(LOGIN_NEEDED)
      retry.used = true
      await d.login.require(still(c), ref, dl.signal)
      return fn(still(c))
    }
  }

  return async (ref, req, signal) => {
    const found = d.findThread(ref)
    if (!found) throw new Error('Thread encerrada')
    const { p, t } = found
    if (req.op === 'list') return d.store.visibleFor(p.path ?? '').map(c => ({ name: c.name, description: c.description }))
    const c = resolve(ref, p, req.name)
    if (req.op === 'call' && !req.tool) throw new Error('Informe a ferramenta')
    if (signal.aborted) throw new Error(CANCELLED)
    // login and approval share one deadline, from the moment the request got here
    const dl = startDeadline(signal, holdMs)
    const retry = { used: false }
    try {
      if (await d.login.needsLogin(c)) await d.login.require(c, ref, dl.signal)
      // reach the connector first: a login it asks for comes before the approval card
      const tools = await withLogin(c, ref, dl, retry, x => d.hub.tools(x, signal))
      if (req.op === 'tools') return toolsText(tools.map(x => ({ name: x.name, description: x.description, inputSchema: x.inputSchema })))
      if (signal.aborted) throw new Error(CANCELLED)
      await approve(still(c), t, req.tool!, req.args, dl)
      // a cancel that lands with Permitir still wins: the call never starts
      if (signal.aborted) throw new Error(CANCELLED)
      const res = await withLogin(c, ref, dl, retry, x => d.hub.call(x, req.tool!, req.args, signal))
      const text = resultText(res.content)
      if (res.isError) throw new Error(text)
      return text
    } finally {
      dl.end()
    }
  }
}
