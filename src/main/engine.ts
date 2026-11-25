import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import type { AgentId, AppState, ApprovalDecision, Attachment, Message, Project, SlashCommand, Thread, Usage } from '../shared/types.ts'
import { MAX_ACTIVE_THREADS } from '../shared/types.ts'
import type { RunHandle } from './adapters/types.ts'
import { addUsage, runOnce } from './run.ts'
import { settleThread } from './settle.ts'
import { maybeSynthesize, reportDirect } from './synthesis.ts'
import { ThreadApprovals } from './approvals.ts'
import { AUTOCOMPACT, coordinatorAutocompact, coordinatorContext, remember, rotateSession } from './coordinator-memory.ts'
import { parseOverride, routeTasks } from './router.ts'
import { ADAPTERS } from './adapters/index.ts'
import { restoreProjects } from './restore.ts'
import { archiveDirFor, archiveProjects } from './archive.ts'
import { appSettings, loadSettings } from './settings.ts'
import { applyThreadEvent } from './thread-events.ts'
import { removeProjectAttachments } from './attachments.ts'
import { discoverCommands, parseSlash } from './commands.ts'
import { runSlash } from './slash.ts'
import {
  PLAN_SCHEMA,
  buildPlanPrompt,
  buildThreadPrompt,
  parsePlan,
  type PlannedTask
} from './coordinator.ts'
import { demoProjects } from './demo.ts'
import { discoverPlugins } from './plugins.ts'
import { loadUserPlugins, userPluginDirs, userPluginsState } from './user-plugins.ts'
import { ProcessManager } from './processes.ts'
import type { JsonStore } from './store.ts'

const TERMINAL = new Set(['done', 'failed', 'cancelled', 'interrupted'])
const zero = (): Usage => ({ input: 0, output: 0, cached: 0, measured: false })

export class Engine extends EventEmitter {
  state: AppState = { projects: [], agents: [], plugins: [] }
  /** plugin dirs for claude runs in a project: BrandyTerm's own plus the user's plugins turned on for threads */
  private pluginsFor(path: string | null): string[] {
    const own = this.state.plugins.flatMap((p) => (p.dir && p.kind !== 'tool' && !p.scanner ? [p.dir] : []))
    return [...own, ...userPluginDirs(path)]
  }
  private procs = new ProcessManager()
  private handles = new Map<string, RunHandle>()
  private chains = new Map<string, Promise<void>>()
  readonly approvals = new ThreadApprovals(() => this.touch())

  private store: JsonStore

  constructor(store: JsonStore) {
    super()
    this.store = store
  }

  async init(): Promise<void> {
    const saved = this.store.load()
    this.state.projects = saved ? saved.projects : demoProjects()
    restoreProjects(this.state.projects)
    archiveProjects(this.state.projects, archiveDirFor(this.store.file))
    this.state.settings = loadSettings(this.state.projects)
    this.state.plugins = discoverPlugins()
    loadUserPlugins()
    this.state.userPlugins = userPluginsState()
    await this.refreshAgents()
    this.touch()
  }

  async refreshAgents(): Promise<void> {
    this.state.agents = await Promise.all(Object.values(ADAPTERS).map((a) => a.detect()))
    this.touch()
  }

  touch(): void {
    this.emit('change')
    this.store.schedule(() => ({ version: 1, projects: this.state.projects }))
  }

  private project(id: string): Project | undefined {
    return this.state.projects.find((p) => p.id === id)
  }

  installed(): Map<AgentId, string[]> {
    const m = new Map<AgentId, string[]>()
    for (const a of this.state.agents) if (a.installed) m.set(a.id, ADAPTERS[a.id].models)
    return m
  }

  msg(author: Message['author'], text: string, extra: Partial<Message> = {}): Message {
    return { id: randomUUID(), author, time: new Date().toISOString(), text, ...extra }
  }

  fail(p: Project, text: string, thread?: Thread): void {
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
    removeProjectAttachments(id)
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

  commands(projectId: string): SlashCommand[] {
    return discoverCommands(this.pluginsFor(this.project(projectId)?.path ?? null), this.project(projectId)?.path ?? null)
  }

  send(projectId: string, text: string, threadId?: string, attachments: Attachment[] = []): void {
    const p = this.project(projectId)
    text = text.trim()
    if (!p || (!text && !attachments.length)) return
    if (p.demo) {
      p.messages.push(this.msg('user', text, { attachments }))
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
    const slash = parseSlash(text)
    if (slash) return runSlash(this, p, slash, threadId ? p.threads.find((t) => t.id === threadId) : undefined, attachments)
    if (threadId) this.sendToThread(p, threadId, text, attachments)
    else this.sendToCoordinator(p, text, attachments)
  }

  enqueue(p: Project, job: () => Promise<void>): void {
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

  async askCoordinator(p: Project, prompt: string, attachments?: Attachment[]): Promise<{ plan: ReturnType<typeof parsePlan> } | { error: string }> {
    const agent = this.coordAgent(p)
    if (!agent) return { error: 'Nenhum agente instalado para ser o coordenador (precisa de Claude ou Codex).' }
    if (p.coordinator.agent !== agent) p.coordinator = { agent, usage: p.coordinator.usage, turns: 1 }
    const { result } = runOnce(ADAPTERS[agent], {
      cwd: p.path!,
      prompt,
      sessionId: p.coordinator.sessionId,
      tools: 'none',
      keepAlive: p.id,
      autocompact: coordinatorAutocompact(),
      effort: agent === 'claude' ? 'medium' : 'low',
      schema: PLAN_SCHEMA,
      attachments
    })
    const r = await result
    if (r.sessionId) p.coordinator.sessionId = r.sessionId
    // the CLI reports the model's 1M window; the coordinator is held to coordinatorContextLimit
    if (r.context) p.coordinator.context = coordinatorContext(r.context, p.coordinator.context)
    addUsage(p.coordinator.usage, r.usage)
    if (!r.done?.ok) return { error: `${agent}: ${r.done?.error ?? 'sem resposta'}` }
    return { plan: parsePlan(r.done.structured, r.done.text, this.installed()) }
  }

  private sendToCoordinator(p: Project, text: string, atts: Attachment[]): void {
    p.messages.push(this.msg('user', text, { attachments: atts.length ? atts : undefined }))
    const route = parseOverride(text)
    const extra = atts.length ? '\n\n(As threads criadas para este pedido recebem os mesmos anexos.)' : ''
    this.enqueue(p, async () => {
      const skills = this.commands(p.id).flatMap((c) => (c.skill ? [c.name] : []))
      const fresh = rotateSession(p)
      const prompt = buildPlanPrompt(p, [...this.installed().keys()], (route.text || '(veja os anexos)') + extra, skills, fresh)
      const res = await this.askCoordinator(p, prompt, atts)
      if ('error' in res) return this.fail(p, `O coordenador falhou. ${res.error}`)
      const { plan } = res
      const requestId = randomUUID()
      const reply = this.msg('coordinator', plan.reply)
      p.messages.push(reply)
      remember(this, p, plan.memory)
      for (const a of plan.answers) {
        const w = p.threads.find((x) => x.state === 'waiting' && x.title.toLowerCase() === a.threadTitle.toLowerCase())
        if (w) this.sendToThread(p, w.id, a.text, [])
      }
      const tasks = await routeTasks(p.path!, plan.tasks, route, this.installed().has('claude'))
      const opened = tasks.map((task) => this.createThread(p, task, requestId, atts).id)
      if (opened.length) reply.threads = opened
      this.pump(p)
    })
  }

  // ---- threads --------------------------------------------------------

  createThread(p: Project, task: PlannedTask, requestId: string, atts: Attachment[] = []): Thread {
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
      skill: task.skill,
      todos: [],
      steps: [],
      state: 'queued',
      note: 'Na fila',
      attachments: atts.length ? atts : undefined,
      messages: [this.msg('coordinator', task.objective, { attachments: atts.length ? atts : undefined })],
      usage: zero(),
      createdAt: now,
      updatedAt: now
    }
    if (appSettings().allowAllThreads) t.allowAll = true
    p.threads.push(t)
    return t
  }

  private pump(p: Project): void {
    let active = p.threads.filter((t) => t.state === 'running').length
    for (const t of p.threads) {
      if (active >= MAX_ACTIVE_THREADS) break
      if (t.state !== 'queued') continue
      this.startThread(p, t, buildThreadPrompt(p, t.objective, t.agent, t.skill), false, t.attachments)
      active++
    }
    this.touch()
  }

  startThread(p: Project, t: Thread, prompt: string, direct: boolean, attachments?: Attachment[]): void {
    t.state = 'running'
    t.resolved = false
    t.pending = undefined
    t.note = 'Iniciando…'
    t.aliveAt = t.runAt = new Date().toISOString()
    t.todos = []
    t.steps = []
    t.updatedAt = new Date().toISOString()
    const { handle, result } = runOnce(
      ADAPTERS[t.agent],
      {
        cwd: p.path!,
        prompt,
        sessionId: t.sessionId,
        model: t.model,
        effort: t.effort,
        tools: 'work',
        approve: (a) => this.approvals.ask(t, a),
        plugins: this.pluginsFor(p.path ?? null),
        autocompact: AUTOCOMPACT,
        attachments
      },
      (e) => applyThreadEvent(p, t, e) && this.touch()
    )
    this.handles.set(t.id, handle)
    this.touch()
    void result.then((r) => {
      this.handles.delete(t.id)
      this.approvals.drop(t)
      if (r.sessionId) t.sessionId = r.sessionId
      addUsage(t.usage, r.usage)
      t.updatedAt = new Date().toISOString()
      const q = settleThread(t, r.done, (author, text, extra) => this.msg(author, text, extra))
      if (q) {
        p.messages.push(
          this.msg('agent', `A thread “${t.title}” precisa de uma decisão sua.`, { ask: { threadId: t.id, question: q.text, options: q.options } })
        )
      }
      if (t.state === 'waiting') {
        // the question card is already in the main chat; synthesis waits for the answer
      } else if (direct && t.state !== 'cancelled') reportDirect(this, p, t)
      else maybeSynthesize(this, p, t.requestId)
      this.pump(p)
    })
  }

  /** `raw` sends the text as typed (slash commands must start the prompt) */
  sendToThread(p: Project, threadId: string, text: string, atts: Attachment[], raw = false): void {
    const t = p.threads.find((x) => x.id === threadId)
    if (!t) return
    t.messages.push(this.msg('user', text, { attachments: atts.length ? atts : undefined }))
    if (t.state === 'running' || t.state === 'queued') {
      this.fail(p, 'A thread ainda está executando. Espere terminar ou cancele para enviar uma nova mensagem.', t)
      this.touch()
      return
    }
    t.question = undefined
    const fresh = !t.sessionId
    const prompt = raw || !fresh ? text : `${buildThreadPrompt(p, t.objective, t.agent, t.skill)}\n\nMensagem do usuário:\n${text}`
    // a thread without a session (interrupted before starting) gets its original files again
    this.startThread(p, t, prompt, true, fresh && !raw ? [...(t.attachments ?? []), ...atts] : atts)
  }

  cancelThread(projectId: string, threadId: string): void {
    const p = this.project(projectId)
    const t = p?.threads.find((x) => x.id === threadId)
    if (!p || !t || TERMINAL.has(t.state)) return
    t.state = 'cancelled'
    t.note = 'Cancelado'
    this.approvals.drop(t)
    this.handles.get(t.id)?.cancel()
    maybeSynthesize(this, p, t.requestId)
    this.pump(p)
    this.touch()
  }

  respondApproval(projectId: string, threadId: string, id: string, decision: ApprovalDecision): void {
    const t = this.project(projectId)?.threads.find((x) => x.id === threadId)
    if (t) this.approvals.respond(t, id, decision)
  }

  /** "permitir tudo" on or off for a thread; turning it on also answers what is waiting */
  setAllowAll(projectId: string, threadId: string, on: boolean): void {
    const t = this.project(projectId)?.threads.find((x) => x.id === threadId)
    if (!t) return
    if (on && t.approval) return this.approvals.respond(t, t.approval.id, 'all')
    t.allowAll = on || undefined
    this.touch()
  }

  /** the user closes a thread left with something pending (solved by hand or not needed) */
  resolveThread(projectId: string, threadId: string): void {
    const t = this.project(projectId)?.threads.find((x) => x.id === threadId)
    if (!t || t.state !== 'done') return
    t.pending = undefined
    t.resolved = true
    this.touch()
  }
}
