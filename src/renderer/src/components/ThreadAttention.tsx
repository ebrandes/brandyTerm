import { CircleCheck, CircleDot, ShieldCheck, ShieldQuestion, X } from 'lucide-react'
import type { ApprovalDecision, Thread } from '../types'
import { contextLabel, contextShare } from '../health'
import './attention.css'

const TOOL_NAMES: Record<string, string> = {
  Bash: 'rodar um comando',
  Edit: 'editar um arquivo',
  Write: 'criar ou sobrescrever um arquivo',
  NotebookEdit: 'editar um notebook',
  WebFetch: 'abrir uma página da web',
  WebSearch: 'pesquisar na web'
}

/** What a thread needs from the user right now: a tool to approve, or a pending item to close. */
export function ThreadAttention({ t, projectId }: { t: Thread; projectId: string }) {
  const a = t.approval
  if (a) {
    const answer = (decision: ApprovalDecision) => void window.brandy.approveTool({ projectId, threadId: t.id, id: a.id, decision })
    const head = a.always ?? (a.tool === 'Bash' ? 'Sempre este comando nesta thread' : 'Sempre nesta thread')
    return (
      <div className="attn approval" role="alert">
        <div className="attn-head">
          <ShieldQuestion size={15} /> A thread quer {TOOL_NAMES[a.tool] ?? `usar ${a.tool}`}
        </div>
        {a.detail && <pre className="attn-detail">{a.detail}</pre>}
        <div className="attn-actions">
          <button className="primary" onClick={() => answer('allow')} autoFocus>
            Permitir
          </button>
          <button onClick={() => answer('always')}>{head}</button>
          <button onClick={() => answer('all')} title="Libera todos os comandos e edições desta thread, até você desligar no topo">
            Permitir tudo nesta thread
          </button>
          <button className="danger" onClick={() => answer('deny')}>
            Negar
          </button>
        </div>
      </div>
    )
  }
  if (t.state === 'done' && t.pending) {
    return (
      <div className="attn pending">
        <div className="attn-head">
          <CircleDot size={14} /> Pendente: {t.pending}
        </div>
        <p className="attn-hint">Responda aqui para a thread continuar, ou feche se já resolveu.</p>
        <div className="attn-actions">
          <button onClick={() => void window.brandy.resolveThread({ projectId, threadId: t.id })}>
            <CircleCheck size={13} /> Marcar como resolvida
          </button>
        </div>
      </div>
    )
  }
  return null
}

/** true when the thread is blocked on the user (question or tool approval) */
export const needsUser = (t: Thread) => t.state === 'waiting' || !!t.approval

/** "Permitindo tudo" badge, with a button to go back to asking. Security alert: keep it visible. */
export function AllowAllChip({ t, projectId }: { t: Thread; projectId: string }) {
  return (
    <span className="chip warn" title="Comandos e edições desta thread rodam sem perguntar">
      <ShieldCheck size={12} /> Permitindo tudo
      <button
        className="chip-x"
        onClick={() => void window.brandy.setAllowAll({ projectId, threadId: t.id, on: false })}
        aria-label="Voltar a pedir aprovação nesta thread"
        title="Voltar a pedir aprovação"
      >
        <X size={11} />
      </button>
    </span>
  )
}

/** Header chips of a thread: "permitindo tudo" (with a way to turn it off) and context in use. */
export function ThreadChips({ t, projectId }: { t: Thread; projectId: string }) {
  const ctx = t.context && t.context.used > 0 ? t.context : undefined
  const rules = t.allow?.length ?? 0
  return (
    <>
      {t.allowAll ? (
        <AllowAllChip t={t} projectId={projectId} />
      ) : (
        rules > 0 && (
          <span className="chip" title={(t.allow ?? []).map((r) => r.replace(/^Bash:/, '')).join(', ')}>
            <ShieldCheck size={12} /> {rules} {rules === 1 ? 'permissão' : 'permissões'} salvas
          </span>
        )
      )}
      {ctx && (
        <span className={`chip${contextShare(ctx) >= 0.7 ? ' warn' : ''}`} title="Contexto em uso na sessão desta thread; perto do limite, o Claude compacta sozinho">
          contexto {contextLabel(ctx)}
        </span>
      )}
    </>
  )
}
