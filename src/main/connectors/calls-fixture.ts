// Test fixture for createCalls: fake store, hub, login and approvals that log what ran, in order.
import { createCalls, type CallsDeps } from './calls.ts'
import type { Connector, ThreadRef } from '../../shared/connectors.ts'
import type { ApprovalDecision } from '../../shared/types.ts'
import type { ApprovalAsk } from '../adapters/types.ts'
import type { GwRequest } from './gateway-protocol.ts'
import type { CallResult, ToolInfo } from './hub.ts'
import { activeIn } from '../../shared/connector-scope.ts'

export const ref: ThreadRef = { projectId: 'p1', threadId: 't1' }
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
export const sig = () => new AbortController().signal
/** polls until `cond` holds; fails after `ms` instead of hanging the test */
export async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('condição não chegou a tempo')
    await sleep(2)
  }
}
export const mk = (o: Partial<Connector> = {}): Connector => ({
  id: 'c1', name: 'Railway', description: 'Deploys', transport: 'stdio', command: 'secret-cmd', enabled: true,
  auth: { kind: 'none' }, alwaysAllow: [], ...o,
})

export interface SetupOpts {
  connectors?: Connector[]
  needsLogin?: boolean
  elsewhere?: string
  holdMs?: number
  /** the approval waits until its signal aborts */
  hold?: boolean
  /** the approval waits for answerNow() */
  defer?: boolean
  result?: unknown
  callError?: Error
  noThread?: boolean
  loginError?: Error
  /** replaces the login wait (after it is logged) */
  require?: (signal: AbortSignal) => Promise<void>
  /** replaces hub.tools (after it is logged) */
  tools?: () => Promise<ToolInfo[]>
  /** replaces hub.call (after it is logged) */
  callImpl?: () => Promise<CallResult>
  /** replaces the approval wait (after it is logged) */
  askImpl?: (a: ApprovalAsk) => Promise<ApprovalDecision>
}

export function setup(o: SetupOpts = {}) {
  const connectors = o.connectors ?? [mk()]
  const log = {
    order: [] as string[], asks: [] as ApprovalAsk[], allowed: [] as string[][], released: [] as string[][],
    notified: [] as string[], calls: [] as unknown[][], loginSignals: [] as AbortSignal[],
  }
  let answer: ApprovalDecision = 'allow'
  let release: (d: ApprovalDecision) => void = () => {}
  const deps: CallsDeps = {
    store: {
      list: () => connectors,
      visibleFor: path => connectors.filter(c => c.enabled && activeIn(c, path)),
      allow: (id, tool) => { log.allowed.push([id, tool]); for (const c of connectors) if (c.id === id) c.alwaysAllow.push(tool) },
    },
    hub: {
      tools: async () => {
        log.order.push('tools')
        return o.tools ? o.tools() : [{ name: 'get_logs', description: 'Logs', inputSchema: { type: 'object' } }]
      },
      call: async (_c, tool, args, signal) => {
        log.order.push('call'); log.calls.push([tool, args, signal])
        if (o.callImpl) return o.callImpl()
        if (o.callError) throw o.callError
        return (o.result ?? { content: [{ type: 'text', text: 'ok' }] }) as CallResult
      },
    },
    login: {
      needsLogin: async () => o.needsLogin ?? false,
      require: async (_c, _r, signal) => {
        log.order.push('login'); log.loginSignals.push(signal)
        if (o.require) return o.require(signal)
        if (o.loginError) throw o.loginError
      },
    },
    approvals: {
      ask: (_t, a) => {
        log.order.push('ask'); log.asks.push(a)
        if (o.askImpl) return o.askImpl(a)
        if (o.defer) return new Promise(res => { release = res })
        if (o.hold) return new Promise(res => a.signal.addEventListener('abort', () => res('deny'), { once: true }))
        return Promise.resolve(answer)
      },
      releaseConnector: (id, tool) => { log.released.push([id, tool]) },
    },
    findThread: r => (o.noThread ? undefined : { p: { id: r.projectId, path: '/proj' }, t: { id: r.threadId } } as never),
    machineName: () => 'PC',
    elsewhere: () => o.elsewhere,
    notify: (_r, text) => { log.notified.push(text) },
    holdMs: o.holdMs,
  }
  const handle = createCalls(deps)
  const req = (op: GwRequest['op'], extra: Partial<GwRequest> = {}): GwRequest => ({ id: 1, token: 't', op, ...extra })
  return { handle, req, log, answerNow: (d: ApprovalDecision) => release(d), setAnswer: (d: ApprovalDecision) => { answer = d } }
}

/** the hub's own events (connector reached, tools listed) left out: the order of holds and the call */
export const holds = (order: string[]): string[] => order.filter(x => x !== 'tools')

export const call = (s: ReturnType<typeof setup>, extra: Partial<GwRequest> = {}, signal = sig()) =>
  s.handle(ref, s.req('call', { name: 'Railway', tool: 'get_logs', args: { n: 1 }, ...extra }), signal)
