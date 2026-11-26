// Test helper for thread-report*.test.ts: a fake ReportHost whose silent runs the test settles by hand.
import type { Message, Project, Thread } from '../shared/types.ts'
import type { Plan } from './coordinator.ts'
import type { MemoryNote } from './memory.ts'
import type { ReportHost, SilentRun } from './thread-report.ts'

type Result = Awaited<SilentRun['result']>
type Coordinator = { plan: Plan } | { error: string }

/** One silent run started by the reporter. */
export interface FakeRun {
  threadId: string
  prompt: string
  cancelled: boolean
  resolve(r: Result): void
  reject(e: unknown): void
}

export const plan = (reply: string, memory: MemoryNote[] = []): Plan => ({
  reply,
  tasks: [],
  answers: [],
  resume: [],
  memory
})

export function thread(extra: Partial<Thread> = {}): Thread {
  return {
    id: 't1',
    requestId: 'r1',
    title: 'T',
    objective: 'o',
    agent: 'claude',
    effort: 'medium',
    state: 'done',
    todos: [],
    steps: [],
    messages: [],
    usage: { input: 0, output: 0, cached: 0, measured: false },
    createdAt: 'c',
    updatedAt: 'u',
    sessionId: 's1',
    ...extra
  }
}

export const project = (t: Thread): Project => ({ id: 'p1', messages: [], threads: [t] }) as unknown as Project

/** lets the reporter's promise callbacks run */
export const flush = (): Promise<void> => new Promise((r) => setImmediate(r))

export function fakeHost() {
  const runs: FakeRun[] = []
  const jobs: (() => Promise<void>)[] = []
  const remembered: MemoryNote[][] = []
  const prompts: string[] = []
  const state = { coordinator: { plan: plan('resposta ao usuário') } as Coordinator, touches: 0 }
  const host: ReportHost = {
    msg: (author: Message['author'], text: string, extra: Partial<Message> = {}): Message => ({
      id: 'm',
      author,
      time: 'now',
      text,
      ...extra
    }),
    touch: () => void state.touches++,
    enqueue: (_p, job) => void jobs.push(job),
    askCoordinator: async (_p, prompt) => {
      prompts.push(prompt)
      return state.coordinator
    },
    remember: (_p, notes) => void remembered.push(notes),
    run: (_p, t, prompt) => {
      let resolve!: (r: Result) => void
      let reject!: (e: unknown) => void
      const result = new Promise<Result>((res, rej) => {
        resolve = res
        reject = rej
      })
      const run: FakeRun = { threadId: t.id, prompt, cancelled: false, resolve, reject }
      runs.push(run)
      return { cancel: () => void (run.cancelled = true), result }
    }
  }
  /** runs the jobs given to enqueue, in order, like the coordinator queue */
  const runJobs = async (): Promise<void> => {
    while (jobs.length) await jobs.shift()!()
  }
  return { host, runs, jobs, remembered, prompts, state, runJobs }
}
