import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import type { AgentId, AppState, Message, Project, Summary, Thread, Usage } from '../shared/types.ts'
import { MAX_ACTIVE_THREADS } from '../shared/types.ts'
import type { AgentAdapter, AgentEvent, RunHandle, RunOpts } from './adapters/types.ts'
import { claudeAdapter } from './adapters/claude.ts'
import { codexAdapter } from './adapters/codex.ts'
import { geminiAdapter } from './adapters/gemini.ts'
import {
  PLAN_SCHEMA,
  buildPlanPrompt,
  buildSynthesisPrompt,
  buildThreadPrompt,
  extractQuestion,
  extractSummary,
  parsePlan,
  type PlannedTask
} from './coordinator.ts'
import { demoProjects } from './demo.ts'
import { discoverPlugins } from './plugins.ts'
import { ProcessManager } from './processes.ts'
import type { JsonStore } from './store.ts'

const ADAPTERS: Record<AgentId, AgentAdapter> = { claude: claudeAdapter, codex: codexAdapter, gemini: geminiAdapter }
const TERMINAL = new Set(['done', 'failed', 'cancelled', 'interrupted'])
/** sessions compact themselves at this many tokens to save cost */
const AUTOCOMPACT = 120000
const zero = (): Usage => ({ input: 0, output: 0, cached: 0, measured: false })

interface RunResult {
  done?: Extract<AgentEvent, { kind: 'done' }>
  sessionId?: string
  usage: { input: number; output: number; cached: number; costUsd: number }
}

function addUsage(target: Usage, u: { input: number; output: number; cached: number; costUsd?: number }): void {
  target.input += u.input
  target.output += u.output
  target.cached += u.cached
  if (u.costUsd) target.costUsd = (target.costUsd ?? 0) + u.costUsd
  target.measured = true
}

export class Engine extends EventEmitter {
  state: AppState = { projects: [], agents: [], plugins: [] }
  /** plugin dirs loaded by default in every claude run (superpowers, token economizer…) */
  private get plugins(): string[] {
    return this.state.plugins.flatMap((p) => (p.dir ? [p.dir] : []))
  }
  private procs = new ProcessManager()
  private handles = new Map<string, RunHandle>()
  private chains = new Map<string, Promise<void>>()

  private store: JsonStore

  constructor(store: JsonStore) {
    super()
    this.store = store
  }

  async init(): Promise<void> {
    const saved = this.store.load()
    this.state.projects = saved ? saved.projects : demoProjects()
    // anything that was in flight when the app closed cannot still be running
    for (const p of this.state.projects) {
      p.busy = false
      p.processes ??= []
      // child processes never survive the app
      for (const x of p.processes) if (x.state === 'running') x.state = 'exited'
      for (const t of p.threads) {
        t.todos ??= []
        t.steps ??= []
      }
      if (p.demo) continue
      for (const t of p.threads) {
        t.todos ??= []
        t.steps ??= []
        if (t.state === 'running' || t.state === 'queued') {
          t.state = 'interrupted'
          t.note = 'Interrompida ao fechar o app. Envie uma mensagem para retomar.'
        }
      }
    }
    this.state.plugins = discoverPlugins()
    await this.refreshAgents()
    this.touch()
  }

  async refreshAgents(): Promise<void> {
    this.state.agents = await Promise.all(Object.values(ADAPTERS).map((a) => a.detect()))
    this.touch()
  }

  private touch(): void {
    this.emit('change')
    this.store.schedule(() => ({ version: 1, projects: this.state.projects }))
  }

  private project(id: string): Project | undefined {
    return this.state.projects.find((p) => p.id === id)
  }

  private installed(): Map<AgentId, string[]> {
    const m = new Map<AgentId, string[]>()
    for (const a of this.state.agents) if (a.installed) m.set(a.id, ADAPTERS[a.id].models)
    return m
  }

  private msg(author: Message['author'], text: string, extra: Partial<Message> = {}): Message {
    return { id: randomUUID(), author, time: new Date().toISOString(), text, ...extra }
  }

  private fail(p: Project, text: string, thread?: Thread): void {
    const m = this.msg('system', text, { isError: true })
    ;(thread ? thread.messages : p.messages).push(m)
  }

  // ---- projects -------------------------------------------------------

  addProject(path: string): string {
    const existing = this.state.projects.find((p) => p.path === path)
    if (existing) return existing.id
    const p: Project = {
      id: randomUUID(),
      name: basename(path) || path,
      path,
      demo: false,
      messages: [],
      threads: [],
      coordinator: { usage: zero() },
      busy: false,
      synthesized: [],
      processes: []
    }
    this.state.projects.push(p)
    this.touch()
    return p.id
  }

  removeProject(id: string): void {
    const p = this.project(id)
    if (!p) return
    for (const t of p.threads) this.handles.get(t.id)?.cancel()
    this.state.projects = this.state.projects.filter((x) => x.id !== id)
    this.touch()
  }

  shutdown(): void {
    this.procs.stopAll()
    for (const h of this.handles.values()) h.cancel()
    this.store.flush()
  }

  // ---- processes ------------------------------------------------------

  startProcess(projectId: string, name: string, command: string): void {
    const p = this.project(projectId)
    if (!p || p.demo || !p.path || !command.trim()) return
    const info = this.procs.start(p.path, name, command, () => this.touch())
    p.processes.push(info)
    this.touch()
  }

  stopProcess(projectId: string, processId: string): void {
    this.project(projectId) && this.procs.stop(processId)
  }

  removeProcess(projectId: string, processId: string): void {
    const p = this.project(projectId)
    if (!p) return
    this.procs.stop(processId)
    p.processes = p.processes.filter((x) => x.id !== processId)
    this.touch()
  }

  // ---- messages -------------------------------------------------------

  send(projectId: string, text: string, threadId?: string): void {
    const p = this.project(projectId)
    text = text.trim()
    if (!p || !text) return
    if (p.demo) {
      p.messages.push(this.msg('user', text))
      this.fail(p, 'Este é um projeto de demonstração e não executa nada. Use "Abrir pasta" para trabalhar em um projeto real.')
      this.touch()
      return
    }
    if (!p.path || !existsSync(p.path) || !statSync(p.path).isDirectory()) {
      p.messages.push(this.msg('user', text))
      this.fail(p, `A pasta do projeto não existe mais: ${p.path}`)
      this.touch()
      return
    }
    if (threadId) this.sendToThread(p, threadId, text)
    else this.sendToCoordinator(p, text)
  }

  private enqueue(p: Project, job: () => Promise<void>): void {
    const prev = this.chains.get(p.id) ?? Promise.resolve()
    const next = prev.then(job).catch((e) => {
      this.fail(p, `Erro interno do coordenador: ${String(e)}`)
    }).finally(() => {
      if (this.chains.get(p.id) === next) {
        this.chains.delete(p.id)
        p.busy = false
      }
      this.touch()
    })
    this.chains.set(p.id, next)
    p.busy = true
    this.touch()
  }

  private coordAgent(p: Project): AgentId | undefined {
    const inst = this.installed()
    if (p.coordinator.agent && inst.has(p.coordinator.agent)) return p.coordinator.agent
    return (['claude', 'codex'] as AgentId[]).find((a) => inst.has(a))
  }

  private runOnce(adapter: AgentAdapter, opts: RunOpts, onEvent?: (e: AgentEvent) => void): { handle: RunHandle; result: Promise<RunResult> } {
    const r: RunResult = { usage: { input: 0, output: 0, cached: 0, costUsd: 0 } }
    const handle = adapter.run(opts, (e) => {
      if (e.kind === 'session') r.sessionId = e.sessionId
      else if (e.kind === 'usage') {
        r.usage.input += e.input
        r.usage.output += e.output
        r.usage.cached += e.cached
        r.usage.costUsd += e.costUsd ?? 0
      } else if (e.kind === 'done') r.done = e
      onEvent?.(e)
    })
    return { handle, result: handle.done.then(() => r) }
  }

  private async askCoordinator(p: Project, prompt: string): Promise<{ plan: ReturnType<typeof parsePlan> } | { error: string }> {
    const agent = this.coordAgent(p)
    if (!agent) return { error: 'Nenhum agente instalado para ser o coordenador (precisa de Claude ou Codex).' }
    if (p.coordinator.agent !== agent) p.coordinator = { agent, usage: p.coordinator.usage }
    const { result } = this.runOnce(ADAPTERS[agent], {
      cwd: p.path!,
      prompt,
      sessionId: p.coordinator.sessionId,
      tools: 'none',
      autocompact: AUTOCOMPACT,
      effort: agent === 'claude' ? 'medium' : 'low',
      schema: PLAN_SCHEMA
    })
    const r = await result
    if (r.sessionId) p.coordinator.sessionId = r.sessionId
    addUsage(p.coordinator.usage, r.usage)
    if (!r.done?.ok) return { error: `${agent}: ${r.done?.error ?? 'sem resposta'}` }
    return { plan: parsePlan(r.done.structured, r.done.text, this.installed()) }
  }

  private sendToCoordinator(p: Project, text: string): void {
    p.messages.push(this.msg('user', text))
    this.enqueue(p, async () => {
      const res = await this.askCoordinator(p, buildPlanPrompt(p, [...this.installed().keys()], text))
      if ('error' in res) return this.fail(p, `O coordenador falhou. ${res.error}`)
      const { plan } = res
      const requestId = randomUUID()
      p.messages.push(this.msg('coordinator', plan.reply))
      for (const a of plan.answers) {
        const w = p.threads.find((x) => x.state === 'waiting' && x.title.toLowerCase() === a.threadTitle.toLowerCase())
        if (w) this.sendToThread(p, w.id, a.text)
      }
      for (const task of plan.tasks) this.createThread(p, task, requestId)
      this.pump(p)
    })
  }

  // ---- threads --------------------------------------------------------

  private createThread(p: Project, task: PlannedTask, requestId: string): Thread {
    const now = new Date().toISOString()
    const t: Thread = {
      id: randomUUID(),
      requestId,
      title: task.title,
      objective: task.objective,
      agent: task.agent,
      model: task.model,
      effort: task.effort,
      why: task.why,
      todos: [],
      steps: [],
      state: 'queued',
      note: 'Na fila',
      messages: [this.msg('coordinator', task.objective)],
      usage: zero(),
      createdAt: now,
      updatedAt: now
    }
    p.threads.push(t)
    return t
  }

  private pump(p: Project): void {
    let active = p.threads.filter((t) => t.state === 'running').length
    for (const t of p.threads) {
      if (active >= MAX_ACTIVE_THREADS) break
      if (t.state !== 'queued') continue
      this.startThread(p, t, buildThreadPrompt(p, t.objective, t.agent), false)
      active++
    }
    this.touch()
  }

  private startThread(p: Project, t: Thread, prompt: string, direct: boolean): void {
    t.state = 'running'
    t.note = 'Iniciando…'
    t.todos = []
    t.steps = []
    t.updatedAt = new Date().toISOString()
    const { handle, result } = this.runOnce(
      ADAPTERS[t.agent],
      { cwd: p.path!, prompt, sessionId: t.sessionId, model: t.model, effort: t.effort, tools: 'readonly', plugins: this.plugins, autocompact: AUTOCOMPACT },
      (e) => {
        if (e.kind === 'session') t.sessionId = e.sessionId
        else if (e.kind === 'todos') {
          t.todos = e.items
          const cur = e.items.find((i) => i.status === 'in_progress')
          if (cur) t.note = cur.text
          this.touch()
        } else if (e.kind === 'activity') {
          const root = (p.path ?? '').replace(/\\/g, '/')
          const short = root ? e.text.replace(/\\/g, '/').split(root).join('.') : e.text
          t.steps.push(short)
          if (t.steps.length > 60) t.steps.shift()
          if (!t.todos.some((i) => i.status === 'in_progress')) t.note = short
          t.updatedAt = new Date().toISOString()
          this.touch()
        }
      }
    )
    this.handles.set(t.id, handle)
    this.touch()
    void result.then((r) => {
      this.handles.delete(t.id)
      if (r.sessionId) t.sessionId = r.sessionId
      addUsage(t.usage, r.usage)
      t.updatedAt = new Date().toISOString()
      if ((t.state as string) === 'cancelled') {
        t.note = 'Cancelado'
      } else if (r.done?.ok) {
        t.messages.push(this.msg('agent', r.done.text))
        const q = extractQuestion(r.done.text)
        if (q) {
          t.state = 'waiting'
          t.question = q
          t.note = 'Aguardando sua resposta'
          t.summary = undefined
          p.messages.push(
            this.msg('agent', `A thread “${t.title}” precisa de uma decisão sua.`, { ask: { threadId: t.id, question: q.text, options: q.options } })
          )
        } else {
          t.state = 'done'
          t.note = undefined
          t.summary = extractSummary(r.done.text)
        }
      } else {
        t.state = 'failed'
        t.note = r.done?.error ?? 'falhou'
        t.messages.push(this.msg('system', `Falhou: ${t.note}`, { isError: true }))
      }
      if (t.state === 'waiting') {
        // the question card is already in the main chat; synthesis waits for the answer
      } else if (direct && t.state !== 'cancelled') this.reportDirect(p, t)
      else this.maybeSynthesize(p, t.requestId)
      this.pump(p)
    })
  }

  private reportDirect(p: Project, t: Thread): void {
    const text = t.state === 'done' ? `A thread “${t.title}” respondeu.` : `A thread “${t.title}” falhou: ${t.note}`
    const summaries: Summary[] | undefined =
      t.state === 'done' && t.summary ? [{ agent: t.agent, title: t.title, text: t.summary, threadId: t.id }] : undefined
    p.messages.push(this.msg('agent', text, { summaries, isError: t.state === 'failed' }))
    this.touch()
  }

  private sendToThread(p: Project, threadId: string, text: string): void {
    const t = p.threads.find((x) => x.id === threadId)
    if (!t) return
    t.messages.push(this.msg('user', text))
    if (t.state === 'running' || t.state === 'queued') {
      this.fail(p, 'A thread ainda está executando. Espere terminar ou cancele para enviar uma nova mensagem.', t)
      this.touch()
      return
    }
    t.question = undefined
    const prompt = t.sessionId ? text : `${buildThreadPrompt(p, t.objective, t.agent)}\n\nMensagem do usuário:\n${text}`
    this.startThread(p, t, prompt, true)
  }

  cancelThread(projectId: string, threadId: string): void {
    const p = this.project(projectId)
    const t = p?.threads.find((x) => x.id === threadId)
    if (!p || !t || TERMINAL.has(t.state)) return
    t.state = 'cancelled'
    t.note = 'Cancelado'
    this.handles.get(t.id)?.cancel()
    this.maybeSynthesize(p, t.requestId)
    this.pump(p)
    this.touch()
  }

  // ---- synthesis ------------------------------------------------------

  private maybeSynthesize(p: Project, requestId: string): void {
    const group = p.threads.filter((t) => t.requestId === requestId)
    if (!group.length || p.synthesized.includes(requestId)) return
    if (!group.every((t) => TERMINAL.has(t.state))) return
    p.synthesized.push(requestId)
    if (group.every((t) => t.state === 'cancelled')) return
    const summaries: Summary[] = group
      .filter((t) => t.state === 'done' || t.state === 'failed')
      .map((t) => ({ agent: t.agent, title: t.title, text: t.summary ?? t.note ?? '', threadId: t.id }))
    this.enqueue(p, async () => {
      const res = await this.askCoordinator(p, buildSynthesisPrompt(group))
      if ('error' in res) {
        p.messages.push(this.msg('coordinator', 'As threads terminaram, mas não consegui montar a síntese. Resultado parcial abaixo.', { summaries }))
        return this.fail(p, `O coordenador falhou na síntese. ${res.error}`)
      }
      p.messages.push(this.msg('coordinator', res.plan.reply, { summaries }))
    })
  }
}
