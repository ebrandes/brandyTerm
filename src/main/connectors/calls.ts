// What the gateway's three tools do in main: list, tools and call, with login and approval holds.
import type { Connector, ThreadRef } from '../../shared/connectors.ts'
import type { ApprovalDecision, Project, Thread } from '../../shared/types.ts'
import type { ApprovalAsk } from '../adapters/types.ts'
import type { GwHandler } from './gateway-server.ts'
import type { ConnectorHub } from './hub.ts'
import type { LoginBroker } from './login.ts'
import type { ConnectorStore } from './store.ts'
import { HOLD_MS } from './login.ts'

export const RESULT_CAP = 100_000
const DETAIL_CAP = 2000

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

class HoldError extends Error {}

/** Waits for the user's answer, giving up after `ms` or when the request is aborted; the ask is always aborted on the way out. */
async function hold(ask: (signal: AbortSignal) => Promise<ApprovalDecision>, request: AbortSignal, ms: number): Promise<ApprovalDecision> {
  const ctl = new AbortController()
  let timer: NodeJS.Timeout | undefined
  let onAbort = () => {}
  const stop = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HoldError('Tempo esgotado esperando aprovação')), ms)
    onAbort = () => reject(new HoldError('Chamada cancelada'))
    request.addEventListener('abort', onAbort, { once: true })
  })
  stop.catch(() => {})
  try {
    return await Promise.race([ask(ctl.signal), stop])
  } finally {
    clearTimeout(timer)
    request.removeEventListener('abort', onAbort)
    ctl.abort()
  }
}

function textOf(content: unknown[]): string {
  const text = content
    .map(part => {
      const p = part as { type?: string; text?: unknown }
      return p?.type === 'text' && typeof p.text === 'string' ? p.text : JSON.stringify(part)
    })
    .join('\n')
  return text.length <= RESULT_CAP ? text : `${text.slice(0, RESULT_CAP)}\n(resultado cortado em ${RESULT_CAP} caracteres)`
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

  async function approve(c: Connector, t: Thread, tool: string, args: unknown, signal: AbortSignal): Promise<void> {
    if (c.alwaysAllow.includes(tool)) return
    const detail = (JSON.stringify(args ?? {}, null, 2) ?? '{}').slice(0, DETAIL_CAP)
    const input = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
    const answer = await hold(
      s => d.approvals.ask(t, { tool: `mcp__${c.id}__${tool}`, input, summary: `${c.name} · ${tool}`, detail, connector: { id: c.id, name: c.name, tool }, signal: s }),
      signal,
      holdMs,
    )
    if (answer === 'deny') throw new Error('Chamada negada pelo usuário')
    if (answer === 'forever') {
      d.store.allow(c.id, tool)
      d.approvals.releaseConnector(c.id, tool)
    }
  }

  return async (ref, req, signal) => {
    const found = d.findThread(ref)
    if (!found) throw new Error('Thread encerrada')
    const { p, t } = found
    if (req.op === 'list') return d.store.visibleFor(p.path ?? '').map(c => ({ name: c.name, description: c.description }))
    const c = resolve(ref, p, req.name)
    if (req.op === 'tools') {
      if (await d.login.needsLogin(c)) await d.login.require(c, ref, signal)
      return (await d.hub.tools(c)).map(x => ({ name: x.name, description: x.description, inputSchema: x.inputSchema }))
    }
    if (!req.tool) throw new Error('Informe a ferramenta')
    if (signal.aborted) throw new Error('Chamada cancelada')
    if (await d.login.needsLogin(c)) await d.login.require(c, ref, signal)
    const fresh = still(c)
    await approve(fresh, t, req.tool, req.args, signal)
    const res = await d.hub.call(still(c), req.tool, req.args, signal)
    const text = textOf(res.content)
    if (res.isError) throw new Error(text)
    return text
  }
}
