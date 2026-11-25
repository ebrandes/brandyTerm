import type { Message, Thread } from './types.ts'

/**
 * Status of a project in the sidebar, derived from its threads.
 * Independent flags: running (activity indicator), waiting (amber dot, asks for action)
 * and news (accent dot: a thread finished or the coordinator wrote since lastSeen).
 * All false means idle: no indicator.
 */
export interface ProjectStatus {
  running: boolean
  waiting: boolean
  news: boolean
  /** running threads (excludes the coordinator, see `running`) */
  runningCount: number
  waitingCount: number
  /** threads that ended (done) after lastSeen */
  done: number
  /** threads that ended (failed) after lastSeen */
  failed: number
  /** coordinator messages (synthesis, replies) posted after lastSeen */
  replies: number
  /** pt-BR text for title and aria-label, e.g. "2 executando · 1 aguardando você"; empty when idle */
  label: string
}

export interface StatusInput {
  /** coordinator call in flight: counts as running even with no thread running */
  busy?: boolean
  threads: Pick<Thread, 'state' | 'approval' | 'updatedAt'>[]
  /** main chat, oldest first */
  messages?: Pick<Message, 'author' | 'time'>[]
}

export interface StatusOptions {
  /** ISO time the user last had this project open; without it nothing counts as news */
  lastSeen?: string
  /** the open project never shows news */
  selected?: boolean
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** coordinator messages newer than `seen`; the chat is chronological, so walk back and stop early */
function unreadReplies(messages: Pick<Message, 'author' | 'time'>[], seen: number): number {
  let n = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const at = Date.parse(messages[i].time)
    if (!(at > seen)) break
    if (messages[i].author === 'coordinator') n++
  }
  return n
}

export function projectStatus(p: StatusInput, opts: StatusOptions = {}): ProjectStatus {
  const seen = opts.lastSeen ? Date.parse(opts.lastSeen) : NaN
  let runningCount = 0
  let waitingCount = 0
  let done = 0
  let failed = 0
  for (const t of p.threads) {
    if (t.state === 'waiting' || t.approval) waitingCount++
    else if (t.state === 'running') runningCount++
    else if ((t.state === 'done' || t.state === 'failed') && !opts.selected && Date.parse(t.updatedAt) > seen) {
      if (t.state === 'done') done++
      else failed++
    }
  }
  const replies = opts.selected ? 0 : unreadReplies(p.messages ?? [], seen)
  const newsCount = done + failed + replies
  const running = runningCount > 0 || !!p.busy
  const parts = [
    runningCount ? `${runningCount} executando` : p.busy ? 'coordenador trabalhando' : '',
    waitingCount ? `${waitingCount} aguardando você` : '',
    newsCount ? plural(newsCount, 'novidade', 'novidades') : '',
  ]
  return {
    running, waiting: waitingCount > 0, news: newsCount > 0,
    runningCount, waitingCount, done, failed, replies, label: parts.filter(Boolean).join(' · '),
  }
}
