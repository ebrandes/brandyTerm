// When to notify: compares each state seen with the one before. Pure (no electron import).
import type { Message, Project, Thread } from '../../shared/types.ts'

export type NotifyKind = 'done' | 'failed' | 'waiting'

export interface NotifyEvent {
  kind: NotifyKind
  projectId: string
  projectName: string
  /** absent: the event is the coordinator's */
  threadId?: string
  threadTitle?: string
}

interface ThreadSeen {
  state: Thread['state']
  awaiting: boolean
}

interface ProjectSeen {
  threads: Map<string, ThreadSeen>
  /** last chat message already judged; it only advances while the coordinator is idle */
  lastMessage: string | undefined
}

const ACTIVE = new Set<Thread['state']>(['queued', 'running', 'waiting'])

const look = (t: Thread): ThreadSeen => ({
  state: t.state,
  awaiting: ACTIVE.has(t.state) && (t.state === 'waiting' || !!t.approval || !!t.logins?.length)
})

function threadKind(before: ThreadSeen, now: ThreadSeen): NotifyKind | null {
  if (now.awaiting) return before.awaiting ? null : 'waiting'
  // only a turn that was under way can end; cancelled and interrupted are the user's or the app's doing
  if (before.state !== 'running' && before.state !== 'queued') return null
  return now.state === 'done' || now.state === 'failed' ? now.state : null
}

// other system errors answer something the user just did; these two are the coordinator's own failure
const FAILURE = /^(O coordenador falhou|Erro interno do coordenador)/
/** the immediate echo of a slash command: not an answer */
const ECHO = /^Rodando `\//

/** the coordinator has no "waiting" state: an answer that ends in a question is waiting for the user */
const asks = (text: string): boolean => /\?[\s*_`"'”’)\]]*$/.test(text)

function coordinatorKind(fresh: Message[]): NotifyKind | null {
  if (fresh.some((m) => m.author === 'system' && m.isError && FAILURE.test(m.text))) return 'failed'
  const answer = fresh.filter((m) => m.author === 'coordinator' && !ECHO.test(m.text)).at(-1)
  if (!answer) return null
  return asks(answer.text) ? 'waiting' : 'done'
}

/** messages after `last`; null when `last` is gone (history replaced: nothing to compare with) */
function since(messages: Message[], last: string | undefined): Message[] | null {
  if (last === undefined) return messages
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].id === last) return messages.slice(i + 1)
  return null
}

export function createTracker() {
  let seen = new Map<string, ProjectSeen>()
  return {
    /** the events since the previous call; a project or thread seen for the first time is only recorded */
    observe(projects: Project[]): NotifyEvent[] {
      const events: NotifyEvent[] = []
      const next = new Map<string, ProjectSeen>()
      for (const p of projects) {
        const before = seen.get(p.id)
        const base = { projectId: p.id, projectName: p.name }
        const threads = new Map<string, ThreadSeen>()
        for (const t of p.threads) {
          const now = look(t)
          threads.set(t.id, now)
          const old = before?.threads.get(t.id)
          const kind = old && threadKind(old, now)
          if (kind) events.push({ kind, ...base, threadId: t.id, threadTitle: t.title })
        }
        let lastMessage = before?.lastMessage
        if (!before) lastMessage = p.messages.at(-1)?.id
        else if (!p.busy) {
          const fresh = since(p.messages, before.lastMessage)
          const kind = fresh && coordinatorKind(fresh)
          if (kind) events.push({ kind, ...base })
          lastMessage = p.messages.at(-1)?.id
        }
        next.set(p.id, { threads, lastMessage })
      }
      seen = next
      return events
    }
  }
}

const WHAT: Record<NotifyKind, string> = { done: 'terminou', failed: 'falhou', waiting: 'aguardando sua resposta' }

const short = (s: string, max: number): string => {
  const line = s.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** project, thread and what happened: nothing from the conversation itself */
export function notificationText(e: NotifyEvent): { title: string; body: string } {
  return { title: short(e.projectName, 60), body: `${short(e.threadId ? (e.threadTitle ?? 'Thread') : 'Coordenador', 60)} — ${WHAT[e.kind]}` }
}
