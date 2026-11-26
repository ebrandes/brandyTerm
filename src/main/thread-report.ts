import type { Message, Project, Summary, Thread } from '../shared/types.ts'
import { markSent } from '../shared/thread-report-state.ts'
import type { Plan } from './coordinator.ts'
import type { MemoryNote } from './memory.ts'
import {
  askPrompt,
  followUpPrompt,
  parseReport,
  reportBody,
  reportNotes,
  reportPrompt,
  reportShort,
  type ReportKind
} from './thread-report-text.ts'

export interface SilentResult {
  ok: boolean
  text: string
  error?: string
  sessionId?: string
}

/** A turn in the thread's own session that leaves the thread's visible state alone. */
export interface SilentRun {
  cancel(): void
  result: Promise<SilentResult>
}

export interface ReportHost {
  msg(author: Message['author'], text: string, extra?: Partial<Message>): Message
  touch(): void
  enqueue(p: Project, job: () => Promise<void>): void
  askCoordinator(p: Project, prompt: string): Promise<{ plan: Plan } | { error: string }>
  remember(p: Project, notes: MemoryNote[]): void
  run(p: Project, t: Thread, prompt: string): SilentRun
}

interface Running {
  run: SilentRun
  thread: Thread
  /** set for an ask run: a cancelled question goes back to the queue */
  question?: string
  /** set for a short report: a cancelled one falls back to the caller's plain notice */
  onCancel?: () => void
}

type Done = (res: SilentResult) => void

const noSession = (t: Thread): string => `A thread “${t.title}” ainda não tem conversa para consultar.`

/** Runs reports and coordinator questions in a thread's session, one at a time per thread. */
export class ThreadReporter {
  private readonly running = new Map<string, Running>()
  private readonly questions = new Map<string, string[]>()
  private readonly host: ReportHost

  constructor(host: ReportHost) {
    this.host = host
  }

  busy(threadId: string): boolean {
    return this.running.has(threadId)
  }

  /** a report (not a question) is being written in the thread's session */
  writing(threadId: string): boolean {
    const cur = this.running.get(threadId)
    return !!cur && cur.question === undefined
  }

  /** false (and nothing runs) when the thread has no session or is busy */
  report(p: Project, t: Thread, kind: ReportKind, onFail?: () => void): boolean {
    if (!t.sessionId || this.occupied(t)) return false
    const onCancel = kind === 'curto' ? onFail : undefined
    this.start(p, t, reportPrompt(kind), { onCancel }, (res) => this.reported(p, t, kind, res, onFail))
    t.reporting = true
    t.reportError = undefined
    this.host.touch()
    return true
  }

  /** returns a pt-BR note when it could not run now ('' when it ran right away) */
  ask(p: Project, t: Thread, question: string): string {
    if (this.occupied(t)) {
      this.queue(t.id).push(question)
      return `A thread “${t.title}” está ocupada; pergunto quando ela parar.`
    }
    if (!t.sessionId) return noSession(t)
    this.startAsk(p, t, question)
    return ''
  }

  /**
   * stops the silent run of a thread (the user is about to talk to it); its result is ignored.
   * A short report falls back to its onFail, so the main chat still hears about the turn.
   */
  cancel(threadId: string): void {
    const cur = this.running.get(threadId)
    if (!cur) return
    this.running.delete(threadId)
    cur.run.cancel()
    if (cur.question !== undefined) this.queue(threadId).unshift(cur.question)
    cur.thread.reporting = false
    this.host.touch()
    cur.onCancel?.()
  }

  /** call after a thread's normal run settles: runs a queued question */
  afterRun(p: Project, t: Thread): void {
    this.drain(p, t)
  }

  private occupied(t: Thread): boolean {
    return t.state === 'running' || t.state === 'queued' || this.busy(t.id)
  }

  private queue(threadId: string): string[] {
    let q = this.questions.get(threadId)
    if (!q) this.questions.set(threadId, (q = []))
    return q
  }

  private drain(p: Project, t: Thread): void {
    const q = this.questions.get(t.id)
    if (!q?.length || this.occupied(t)) return
    if (!t.sessionId) {
      this.questions.delete(t.id)
      p.messages.push(this.host.msg('system', noSession(t), { isError: true }))
      this.host.touch()
      return
    }
    const question = q.shift()!
    if (!q.length) this.questions.delete(t.id)
    this.startAsk(p, t, question)
  }

  private start(p: Project, t: Thread, prompt: string, extra: Pick<Running, 'question' | 'onCancel'>, done: Done): void {
    const entry: Running = { run: this.host.run(p, t, prompt), thread: t, ...extra }
    const startedWith = t.sessionId
    this.running.set(t.id, entry)
    void entry.run.result
      .catch((e: unknown): SilentResult => ({ ok: false, text: '', error: e instanceof Error ? e.message : String(e) }))
      .then((res) => {
        // cancelled: the user took the thread over, nothing of this run is kept
        if (this.running.get(t.id) !== entry) return
        this.running.delete(t.id)
        // a session changed meanwhile (/clear, /compact) wins over the one this run continued
        if (res.sessionId && t.sessionId === startedWith) t.sessionId = res.sessionId
        done(res.ok && !res.text.trim() ? { ...res, ok: false } : res)
        this.drain(p, t)
      })
  }

  private reported(p: Project, t: Thread, kind: ReportKind, res: SilentResult, onFail?: () => void): void {
    t.reporting = false
    if (!res.ok) {
      if (kind === 'curto' && onFail) onFail()
      else {
        t.reportError = res.error || 'sem resposta'
        p.messages.push(this.failure(`Não consegui o resumo da thread “${t.title}”`, res))
      }
      return this.host.touch()
    }
    const r = parseReport(res.text)
    if (r.feito) t.summary = r.feito
    markSent(t, new Date().toISOString())
    // the report itself goes in the markdown text; the card only links to the thread
    const summaries: Summary[] = [{ agent: t.agent, title: t.title, text: reportShort(r), threadId: t.id }]
    const label = kind === 'curto' ? 'Resumo' : 'Relatório'
    p.messages.push(this.host.msg('agent', `${label} da thread “${t.title}”\n\n${reportBody(r, kind)}`, { summaries }))
    this.host.remember(p, reportNotes(t.title, r, kind))
    this.host.touch()
  }

  private startAsk(p: Project, t: Thread, question: string): void {
    this.start(p, t, askPrompt(question), { question }, (res) => {
      if (!res.ok) {
        p.messages.push(this.failure(`Não consegui perguntar à thread “${t.title}”`, res))
        return this.host.touch()
      }
      const answer = res.text.trim()
      this.host.enqueue(p, async () => {
        const out = await this.host.askCoordinator(p, followUpPrompt(t.title, question, answer))
        if ('error' in out) {
          const text = `Não consegui repassar a resposta da thread “${t.title}”.`
          p.messages.push(this.host.msg('system', text, { isError: true }))
        } else p.messages.push(this.host.msg('coordinator', out.plan.reply))
        this.host.touch()
      })
    })
  }

  private failure(prefix: string, res: SilentResult): Message {
    return this.host.msg('system', `${prefix}: ${res.error || 'sem resposta'}`, { isError: true })
  }
}
