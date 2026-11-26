import { modelLabel } from '../../../shared/thread-phase'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { AGENT_NAMES, EFFORT_LABEL, type Effort, type Thread } from '../types'
import { AgentBadge } from './AgentBadge'
import { AllowAllChip, ThreadChips } from './ThreadAttention'
import './thread-meta-chips.css'

/** global preference (every thread): "1" = details expanded */
const STORAGE_KEY = 'brandyterm.threadMeta.open'

const EFFORT_SHORT: Record<Effort, string> = { low: 'Esf. baixo', medium: 'Esf. médio', high: 'Esf. alto' }

const readOpen = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Chips under the thread title. Collapsed (default): one line with agent/model, short effort
 * and the "Permitindo tudo" alert. Expanded: route, skill, saved permissions and context too.
 */
export function ThreadMetaChips({ thread, projectId, connectorNames }: { thread: Thread; projectId: string; connectorNames?: Record<string, string> }) {
  const [open, setOpen] = useState(readOpen)
  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    } catch {
      /* storage unavailable: keep the choice for this session only */
    }
  }
  const regionId = `thread-meta-${thread.id}`

  return (
    <div id={regionId} className={`chips meta-chips${open ? ' open' : ''}`}>
      <span className="chip">
        <AgentBadge agent={thread.agent} size="sm" /> {AGENT_NAMES[thread.agent]}
        {modelLabel(thread) ? ` ${modelLabel(thread)}` : ''}
      </span>
      {open ? (
        <>
          <span className="chip">{EFFORT_LABEL[thread.effort]}</span>
          {thread.why && (
            <span className="chip why" title={thread.why}>
              {thread.why}
            </span>
          )}
          {thread.skill && (
            <span className="chip" title="Skill que a thread carregou primeiro">
              skill {thread.skill}
            </span>
          )}
          <ThreadChips t={thread} projectId={projectId} connectorNames={connectorNames} />
        </>
      ) : (
        <>
          <span className="chip" title={EFFORT_LABEL[thread.effort]}>
            {EFFORT_SHORT[thread.effort]}
          </span>
          {thread.allowAll && <AllowAllChip t={thread} projectId={projectId} />}
        </>
      )}
      <button
        type="button"
        className="meta-toggle"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={regionId}
        title={open ? 'Recolher detalhes da thread' : 'Mostrar rota, skill, permissões e contexto'}
      >
        <ChevronDown size={13} className="meta-chevron" aria-hidden />
        {open ? 'Menos' : 'Detalhes'}
      </button>
    </div>
  )
}
