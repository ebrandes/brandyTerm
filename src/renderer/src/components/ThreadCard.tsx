import { modelLabel } from '../../../shared/thread-phase'
import { useLayoutEffect, useRef, useState, type SyntheticEvent } from 'react'
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Clock3,
  Gauge,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  Square,
  TriangleAlert
} from 'lucide-react'
import { AGENT_NAMES, EFFORT_LABEL, type Project, type Thread } from '../types'
import { AgentBadge } from './AgentBadge'
import { contextLabel, contextShare, stalledMinutes, useNow } from '../health'
import { retiredLabel } from '../../../shared/thread-retire.ts'
import './thread-card.css'

type Tone = 'run' | 'wait' | 'done' | 'fail' | 'idle'

const STATE: Record<Thread['state'], { label: string; tone: Tone }> = {
  running: { label: 'Em execução', tone: 'run' },
  waiting: { label: 'Aguardando você', tone: 'wait' },
  done: { label: 'Resolvida', tone: 'done' },
  queued: { label: 'Em fila', tone: 'idle' },
  failed: { label: 'Falhou', tone: 'fail' },
  interrupted: { label: 'Interrompida', tone: 'fail' },
  cancelled: { label: 'Cancelada', tone: 'idle' }
}

function status(t: Thread, stalled?: number): { label: string; tone: Tone } {
  if (t.retired) return { label: retiredLabel(t).replace(/^./, (c) => c.toUpperCase()), tone: 'idle' }
  if (t.approval) return { label: 'Aprovar ação', tone: 'wait' }
  if (stalled !== undefined) return { label: 'Parada?', tone: 'wait' }
  if (t.state === 'done' && t.pending) return { label: 'Pendente', tone: 'wait' }
  return STATE[t.state]
}

function StateIcon({ t, stalled }: { t: Thread; stalled?: number }) {
  const state = t.state
  if (t.retired) return <Clock3 size={13} />
  if (t.approval) return <MessageCircleQuestion size={13} />
  if (stalled !== undefined) return <TriangleAlert size={13} />
  if (state === 'running') return <Loader2 size={13} className="spin" />
  if (state === 'done') return t.pending ? <CircleDot size={13} /> : <CircleCheck size={13} />
  if (state === 'waiting') return <MessageCircleQuestion size={13} />
  if (state === 'failed' || state === 'interrupted') return <CircleAlert size={13} />
  return <Clock3 size={13} />
}

/** Summary clamped to 3 lines; clicking it (or the toggle) expands it in place. */
function Summary({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || expanded) return
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, expanded])

  const canExpand = clamped || expanded
  const toggle = (e: SyntheticEvent) => {
    e.stopPropagation()
    setExpanded((v) => !v)
  }
  return (
    <div className={`tcard-summary-wrap${canExpand ? ' can-expand' : ''}`}>
      <p ref={ref} className={`tcard-summary${expanded ? ' expanded' : ''}`} onClick={canExpand ? toggle : undefined}>
        {text}
      </p>
      {canExpand && (
        <button className="tcard-more" onClick={toggle} aria-expanded={expanded}>
          <ChevronDown size={13} className="chev" />
          {expanded ? 'Mostrar menos' : 'Mostrar mais'}
        </button>
      )}
    </div>
  )
}

interface Props {
  t: Thread
  project: Project
  selected: boolean
  onSelect: (id: string) => void
  onCancel: (id: string) => void
}

export function ThreadCard({ t, project, selected, onSelect, onCancel }: Props) {
  const now = useNow()
  const stalled = stalledMinutes(t, now)
  const st = status(t, stalled)
  const ctx = t.context && t.context.used > 0 ? t.context : undefined
  const open = t.state === 'running' || t.state === 'queued' || t.state === 'waiting'
  const todos = t.todos ?? []
  const done = todos.filter((x) => x.status === 'completed').length
  const text = open || t.state !== 'done' ? t.note : t.summary
  const canOpen = !project.demo

  return (
    <article className={`tcard tone-${st.tone}${selected ? ' selected' : ''}`}>
      <div className="tcard-top">
        <span className="tcard-status">
          <StateIcon t={t} stalled={stalled} />
          {st.label}
        </span>
        {open && canOpen && (
          <button
            className="tcard-cancel"
            onClick={(e) => {
              e.stopPropagation()
              onCancel(t.id)
            }}
            aria-label={`Cancelar a thread ${t.title}`}
          >
            <Square size={9} /> Cancelar
          </button>
        )}
      </div>

      <h3 className="tcard-title" title={t.title}>
        {/* the title button stretches over the whole card: one tab stop, one click target */}
        <button
          className="tcard-open"
          onClick={() => canOpen && onSelect(t.id)}
          aria-pressed={selected}
          aria-disabled={!canOpen || undefined}
        >
          <span className="tcard-title-text">{t.title}</span>
        </button>
      </h3>

      <div className="tcard-meta">
        <span className="tcard-agent">
          <AgentBadge agent={t.agent} size="sm" />
          {AGENT_NAMES[t.agent]}
          {modelLabel(t) && <span className="tcard-model">{modelLabel(t)}</span>}
        </span>
        <span>
          <Gauge size={12} />
          {EFFORT_LABEL[t.effort]}
        </span>
        {ctx && (
          <span className={`tcard-ctx${contextShare(ctx) >= 0.7 ? ' high' : ''}`} title={`Contexto em uso: ${contextLabel(ctx)}`}>
            ctx {Math.round(contextShare(ctx) * 100)}%
          </span>
        )}
        {todos.length > 0 && (
          <span className="tcard-progress" title={`${done} de ${todos.length} tarefas concluídas`}>
            <ListChecks size={12} />
            {done}/{todos.length}
          </span>
        )}
      </div>

      {todos.length > 0 && open && (
        <div className="tcard-bar" aria-hidden="true">
          <i style={{ width: `${(done / todos.length) * 100}%` }} />
        </div>
      )}
      {stalled !== undefined && (
        <p className="tcard-alert" role="status">
          Sem sinal há {stalled} min{t.steps.length ? ` em: ${t.steps[t.steps.length - 1]}` : ''}. Pode ser um comando longo; abra para ver ou cancele.
        </p>
      )}
      {t.approval && <p className="tcard-alert">Esperando você permitir: {t.approval.summary}</p>}
      {t.pending && !open && <p className="tcard-pending">Falta: {t.pending}</p>}
      {text && <Summary text={text} />}
    </article>
  )
}
