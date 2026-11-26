import { CircleAlert, CircleCheck, CircleDot, Clock3, Loader2, MessageCircleQuestion, SquareArrowOutUpRight } from 'lucide-react'
import { AGENT_NAMES, type Thread } from '../types'
import { AgentBadge } from './AgentBadge'
import { retiredLabel } from '../../../shared/thread-retire.ts'

/** Short state of a thread, auto-resolve included. */
export function threadStatus(t: Thread): { label: string; cls: string } {
  if (t.retired) return { label: retiredLabel(t), cls: 'st-queued' }
  if (t.approval) return { label: 'aprovar ação', cls: 'st-waiting' }
  if (t.state === 'running') return { label: 'rodando', cls: 'st-running' }
  if (t.state === 'queued') return { label: 'na fila', cls: 'st-queued' }
  if (t.state === 'waiting') return { label: 'aguardando você', cls: 'st-waiting' }
  if (t.state === 'done') return t.pending ? { label: 'pendente', cls: 'st-waiting' } : { label: 'resolvida', cls: 'st-done' }
  if (t.state === 'cancelled') return { label: 'cancelada', cls: 'st-queued' }
  if (t.state === 'interrupted') return { label: 'interrompida', cls: 'st-failed' }
  return { label: 'falhou', cls: 'st-failed' }
}

function Icon({ t }: { t: Thread }) {
  if (t.retired) return <Clock3 size={12} />
  if (t.state === 'waiting' || t.approval) return <MessageCircleQuestion size={12} />
  if (t.state === 'running') return <Loader2 size={12} className="spin" />
  if (t.state === 'done') return t.pending ? <CircleDot size={12} /> : <CircleCheck size={12} />
  if (t.state === 'failed' || t.state === 'interrupted') return <CircleAlert size={12} />
  return <Clock3 size={12} />
}

/** Clickable link to a thread, with its live state: opens the thread in the chat. */
export function ThreadChip({ t, onOpen }: { t: Thread; onOpen: (id: string) => void }) {
  const st = threadStatus(t)
  return (
    <button className="thread-chip" onClick={() => onOpen(t.id)} title={t.pending ? `Pendente: ${t.pending}` : t.retired ? t.note : t.objective}>
      <AgentBadge agent={t.agent} size="sm" />
      <span className="thread-chip-title">{t.title}</span>
      <span className={`thread-chip-state ${st.cls}`}>
        <Icon t={t} /> {st.label}
      </span>
      <SquareArrowOutUpRight size={12} className="thread-chip-open" aria-label={`Abrir thread ${t.title} (${AGENT_NAMES[t.agent]})`} />
    </button>
  )
}
