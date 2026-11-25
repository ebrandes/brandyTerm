import { CircleCheck, CircleDot, Circle, MessageSquare, Square, X } from 'lucide-react'
import { AGENT_NAMES, EFFORT_LABEL, type Todo } from '../types'
import type { BoardItem } from './Board'

/** "há 12 s", "há 3 min", "há 2 h", "há 9 d" */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 60) return `há ${s} s`
  if (s < 3600) return `há ${Math.floor(s / 60)} min`
  if (s < 172800) return `há ${Math.floor(s / 3600)} h`
  return `há ${Math.floor(s / 86400)} d`
}

function TodoIcon({ status }: { status: Todo['status'] }) {
  if (status === 'completed') return <CircleCheck size={13} className="ok" />
  if (status === 'in_progress') return <CircleDot size={13} className="run" />
  return <Circle size={13} />
}

interface Props {
  item: BoardItem
  now: number
  onClose: () => void
  onOpen: () => void
}

/** Side panel of the board: everything known about one thread, live. */
export function BoardDetail({ item, now, onClose, onOpen }: Props) {
  const { project, thread: t } = item
  const active = t.state === 'running' || t.state === 'queued' || t.state === 'waiting'
  const tokens = t.usage.input + t.usage.output
  return (
    <aside className="board-detail" aria-label={`Detalhes de ${t.title}`}>
      <header>
        <div>
          <span className="board-project">{project.name}</span>
          <h3>{t.title}</h3>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar detalhes">
          <X size={14} />
        </button>
      </header>

      <dl className="board-facts">
        <dt>Agente</dt>
        <dd>
          {AGENT_NAMES[t.agent]}
          {t.model ? ` ${t.model}` : ''} · {EFFORT_LABEL[t.effort]}
        </dd>
        {t.why && (
          <>
            <dt>Por quê</dt>
            <dd>{t.why}</dd>
          </>
        )}
        <dt>Criada</dt>
        <dd>{ago(t.createdAt, now)}</dd>
        <dt>Última ação</dt>
        <dd>{ago(t.updatedAt, now)}</dd>
        <dt>Tokens</dt>
        <dd>{t.usage.measured ? tokens.toLocaleString('pt-BR') : 'sem medição'}</dd>
      </dl>

      {t.state === 'waiting' && t.question && (
        <section className="board-question">
          <h4>Pergunta para você</h4>
          <p>{t.question.text}</p>
          {t.question.options && <p className="muted">Opções: {t.question.options.join(' · ')}</p>}
        </section>
      )}

      <section>
        <h4>Objetivo</h4>
        <p className="board-objective">{t.objective}</p>
      </section>

      {t.todos.length > 0 && (
        <section>
          <h4>Plano</h4>
          <ul className="board-todos">
            {t.todos.map((x, i) => (
              <li key={i} className={x.status}>
                <TodoIcon status={x.status} /> {x.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {t.steps.length > 0 && (
        <section>
          <h4>Atividade recente</h4>
          <ol className="board-steps">
            {[...t.steps].reverse().slice(0, 20).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      )}

      {t.summary && t.state === 'done' && (
        <section>
          <h4>Resultado</h4>
          <p>{t.summary}</p>
        </section>
      )}

      <footer>
        {!project.demo && (
          <button onClick={onOpen}>
            <MessageSquare size={13} /> Abrir conversa
          </button>
        )}
        {active && !project.demo && (
          <button className="danger" onClick={() => void window.brandy.cancelThread({ projectId: project.id, threadId: t.id })}>
            <Square size={11} /> Cancelar
          </button>
        )}
      </footer>
    </aside>
  )
}
