// Deferred apply of worktrees to project folders: waits until nothing runs in any project, then
// applies one approved request at a time. The rules are in shared/apply-queue.ts.
import * as rules from '../shared/apply-queue.ts'
import type { ApplyItem, ApplyQueueView } from '../shared/apply-queue.ts'
import { runningItems, type RunningItem } from '../shared/running.ts'
import type { Message, Project } from '../shared/types.ts'
import { applyPatch, checkPatch, isApplied, makePatch, toplevel } from './apply-git.ts'
import { buildItem, type ApplyRequest } from './apply-request.ts'
import { ApplyStore } from './apply-store.ts'

/** What the queue needs from the engine. */
export interface QueueHost {
  state: { projects: Project[]; applyQueue?: ApplyQueueView }
  msg(author: Message['author'], text: string, extra?: Partial<Message>): Message
  touch(): void
  on(event: 'change', fn: () => void): unknown
  off(event: 'change', fn: () => void): unknown
}

const TICK_MS = 5_000

export class ApplyQueue {
  private items: ApplyItem[]
  private store: ApplyStore
  private host: QueueHost
  private now: () => number
  private bootAt: number
  private idleSince: number | null = null
  private lastApplyAt: number | null = null
  private working = false
  private published = ''
  private timer?: ReturnType<typeof setInterval>

  constructor(host: QueueHost, userData: string, now: () => number = Date.now) {
    this.host = host
    this.now = now
    this.bootAt = now()
    this.store = new ApplyStore(userData)
    this.items = this.store.load()
  }

  /** settles what a restart left in the middle, then watches the app */
  async start(): Promise<void> {
    this.host.on('change', this.onChange)
    this.timer = setInterval(() => void this.tick().catch((e) => console.error('[apply]', e)), TICK_MS)
    this.timer.unref?.()
    this.onChange()
    await this.exclusive(async () => {
      for (const i of this.items.filter((x) => x.status === 'applying')) await this.reconcile(i)
    })
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.host.off('change', this.onChange)
  }

  running(): RunningItem[] {
    return runningItems(this.host.state.projects)
  }

  list(): ApplyItem[] {
    return rules.visibleItems(this.items)
  }

  /** a thread asks: the item waits for the user's approval */
  async request(projectId: string, threadId: string | undefined, req: ApplyRequest): Promise<{ position: number; warning?: string }> {
    const p = this.project(projectId)
    if (!p) throw new Error('Projeto não encontrado.')
    const item = await buildItem(p, threadId, req, this.now())
    const root = await toplevel(p.path!)
    const file = this.store.patchFile(item.id)
    await makePatch(root, item.base, item.head, file)
    const problem = await checkPatch(root, file)
    this.set(rules.enqueue(this.items, item))
    const position = this.items.filter((i) => i.status !== 'applied' && i.status !== 'cancelled').length
    return {
      position,
      ...(problem ? { warning: `Agora o patch não aplica na pasta do projeto (${problem}). Se a worktree começou com um commit que copia mudanças não commitadas, passe esse commit em "base".` } : {})
    }
  }

  approve(id: string): void {
    this.set(rules.approve(this.items, id))
  }

  cancel(id: string): void {
    this.set(rules.cancel(this.items, id))
    if (!this.items.some((i) => i.id === id && i.status !== 'cancelled')) this.store.dropPatch(id)
  }

  retry(id: string): void {
    this.set(rules.retry(this.items, id))
  }

  async tick(): Promise<void> {
    this.onChange()
    const times = { idleSince: this.idleSince, lastApplyAt: this.lastApplyAt, bootAt: this.bootAt }
    const next = rules.nextAction(this.items, this.running().length, this.now(), times)
    if (!('apply' in next)) return
    await this.exclusive(() => this.apply(next.apply))
  }

  private async exclusive(work: () => Promise<void>): Promise<void> {
    if (this.working) return
    this.working = true
    try { await work() } finally { this.working = false }
  }

  private async apply(id: string): Promise<void> {
    const item = this.items.find((i) => i.id === id)
    if (!item) return
    try {
      const path = this.project(item.projectId)?.path
      if (!path) throw new Error('O projeto não está mais no app.')
      const root = await toplevel(path)
      const file = this.store.patchFile(id)
      await makePatch(root, item.base, item.head, file)
      const problem = await checkPatch(root, file)
      if (problem) {
        if (await isApplied(root, file)) return this.applied(item, 'já estava na pasta do projeto')
        throw new Error(`O patch não aplica na pasta do projeto; nada foi alterado. ${problem}`)
      }
      // the checks above took time: the user may have cancelled, or something may have started
      if (this.running().length || !this.items.some((i) => i.id === id && i.status === 'pending')) return
      // saved before git writes: if the restart cuts this short, start() finds out what happened
      this.set(rules.settle(this.items, id, { status: 'applying' }))
      this.lastApplyAt = this.now()
      await applyPatch(root, file)
      this.applied(item)
    } catch (e) {
      this.failed(item, e instanceof Error ? e.message : String(e))
    }
  }

  private async reconcile(item: ApplyItem): Promise<void> {
    try {
      const path = this.project(item.projectId)?.path
      if (!path) throw new Error('O projeto não está mais no app.')
      const root = await toplevel(path)
      const file = this.store.patchFile(item.id)
      await makePatch(root, item.base, item.head, file)
      if (await isApplied(root, file)) return this.applied(item)
      if (await checkPatch(root, file)) throw new Error('O app fechou durante a aplicação e o estado ficou indefinido: confira a pasta do projeto.')
      // nothing was written: back to the queue
      this.set(this.items.map((i) => (i.id === item.id ? { ...i, status: 'pending' as const } : i)))
    } catch (e) {
      this.failed(item, e instanceof Error ? e.message : String(e))
    }
  }

  private applied(item: ApplyItem, note?: string): void {
    this.lastApplyAt = this.now()
    this.set(rules.settle(this.items, item.id, { status: 'applied', appliedAt: new Date(this.now()).toISOString() }))
    this.store.dropPatch(item.id)
    this.say(item, `Aplicado na pasta do projeto: ${item.title}${note ? ` (${note})` : ''}.`)
  }

  private failed(item: ApplyItem, error: string): void {
    this.set(rules.settle(this.items, item.id, { status: 'failed', error }))
    this.say(item, `Não foi possível aplicar “${item.title}”: ${error}`, true)
  }

  private say(item: ApplyItem, text: string, isError?: boolean): void {
    const p = this.project(item.projectId)
    if (!p) return
    p.messages.push(this.host.msg('system', text, isError ? { isError } : undefined))
    this.host.touch()
  }

  private project(id: string): Project | undefined {
    return this.host.state.projects.find((p) => p.id === id)
  }

  private set(items: ApplyItem[]): void {
    this.store.save(items)
    this.items = items
    this.onChange()
  }

  /** tracks since when nothing runs and republishes the view; touches only when it changed */
  private onChange = (): void => {
    const count = this.running().length
    this.idleSince = count ? null : (this.idleSince ?? this.now())
    const items = this.list()
    const view = items.length ? { items, running: count } : undefined
    const key = view ? JSON.stringify(view) : ''
    if (key === this.published) return
    this.published = key
    this.host.state.applyQueue = view
    this.host.touch()
  }
}
