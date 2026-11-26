import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, Circle, CircleCheck, ListChecks, Loader2, Paperclip, Sparkles, SquareTerminal, User } from 'lucide-react'
import { AGENT_NAMES, type AgentId, type Message, type Project, type Thread } from '../types'
import { AgentBadge } from './AgentBadge'
import { Rich } from './Rich'
import { TerminalPanel } from './TerminalPanel'
import { ThreadChip } from './ThreadChip'
import { Composer } from './Composer'
import { MessageFiles } from './MessageFiles'
import { ArtifactCards } from './ArtifactCards'
import { filesForSummary } from '../artifacts'
import { filesOf, type PendingFile } from '../attach'
import { ThreadAttention } from './ThreadAttention'
import { ThreadReportButton } from './ThreadReportButton'
import { AskCard } from './AskCard'
import { ThreadAsk } from './ThreadAsk'
import { stripQuestion } from '../../../shared/ask-question.ts'
import { ThreadMetaChips } from './ThreadMetaChips'
import { MachineChip } from './MachineChip'
import { terminalAccess } from '../machine-groups'

interface Props {
  project: Project
  thread?: Thread
  draft: string
  onDraft: (text: string) => void
  files: PendingFile[]
  onAddFiles: (files: File[]) => void
  onRemoveFile: (key: string) => void
  onMarked: (key: string, blob: Blob, marks: NonNullable<PendingFile['marks']>, original: Blob) => void
  sending: boolean
  sendError?: string
  onSend: () => void
  onBack: () => void
  terminalOpen: boolean
  onToggleTerminal: () => void
  onOpenThread: (threadId: string) => void
  /** another machine is paired or visible: conversations say which one they run on */
  showMachine?: boolean
  /** connector id -> name, so saved permissions read `Railway · get_logs` */
  connectorNames?: Record<string, string>
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

function Avatar({ m, agent }: { m: Message; agent?: AgentId }) {
  if (m.author === 'user') return <div className="avatar"><User size={15} /></div>
  if (m.author === 'agent' && agent) return <div className="avatar"><AgentBadge agent={agent} size="sm" /></div>
  return <div className="avatar accent"><Sparkles size={15} /></div>
}

function MessageView({ m, agent, thread, project, onOpenThread }: { m: Message; agent?: AgentId; thread?: Thread; project: Project; onOpenThread: (id: string) => void }) {
  const inThread = !!thread
  // in its own thread, the question lines of a reply become the card below the text
  const asking = m.author === 'agent' && !m.plan ? thread : undefined
  const text = asking ? stripQuestion(m.text) : m.text
  // artifact cards need a real project folder
  const artifacts = !project.demo && !!project.path
  // each summary shows only the files of the run it reports
  const runFiles = (threadId: string) =>
    filesForSummary(project.threads.find((t) => t.id === threadId)?.files ?? [], project.messages, project.messages.indexOf(m), threadId)
  const linked = (m.threads ?? []).map((id) => project.threads.find((t) => t.id === id)).filter((t): t is Thread => !!t)
  if (m.author === 'system')
    return (
      <div className={`notice${m.isError ? ' notice-error' : ''}`}>
        <Rich text={m.text} />
      </div>
    )
  const label =
    m.author === 'user'
      ? 'Você'
      : m.author === 'coordinator'
        ? inThread
          ? 'Delegado pelo coordenador'
          : 'Coordenador'
        : agent
          ? AGENT_NAMES[agent]
          : 'Thread'
  return (
    <div className={`msg${m.author === 'user' ? ' mine' : ''}`}>
      <Avatar m={m} agent={agent} />
      <div className="msg-body">
        <div className="msg-head">
          <span className="msg-author">{label}</span>
          <span className="msg-time">{time(m.time)}</span>
        </div>
        {m.attachments?.length ? <MessageFiles items={m.attachments} projectId={project.id} /> : null}
        {text && (
          <div className={`bubble${m.isError ? ' msg-error' : ''}`}>
            <Rich text={text} projectId={project.demo || !project.path ? undefined : project.id} />
          </div>
        )}
        {linked.length > 0 && (
          <div className="thread-chips">
            {linked.map((t) => (
              <ThreadChip key={t.id} t={t} onOpen={onOpenThread} />
            ))}
          </div>
        )}
        {m.ask && <AskCard project={project} ask={m.ask} onOpenThread={thread ? undefined : onOpenThread} />}
        {asking && <ThreadAsk project={project} thread={asking} message={m} />}
        {m.summaries && (
          <div className="summaries">
            <div className="summaries-head">
              <ListChecks size={14} /> Resumos recebidos
            </div>
            {m.summaries.map((s) => (
              <div
                className={`summary${s.threadId ? ' clickable' : ''}`}
                key={s.title}
                role={s.threadId ? 'button' : undefined}
                tabIndex={s.threadId ? 0 : undefined}
                onClick={() => s.threadId && onOpenThread(s.threadId)}
                onKeyDown={(e) => s.threadId && (e.key === 'Enter' || e.key === ' ') && onOpenThread(s.threadId)}
                title={s.threadId ? 'Abrir a thread' : undefined}
              >
                <AgentBadge agent={s.agent} />
                <div>
                  <div className="summary-title">
                    {AGENT_NAMES[s.agent]} <span className="sep">·</span> {s.title}
                  </div>
                  <div className="summary-text">{s.text}</div>
                  {artifacts && s.threadId && <ArtifactCards projectId={project.id} files={runFiles(s.threadId)} />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Live plan + collapsed actions of the current run, Claude Code style. */
function RunPanel({ t }: { t: Thread }) {
  const total = t.todos.length
  const done = t.todos.filter((x) => x.status === 'completed').length
  const running = t.state === 'running'
  if (!total && !t.steps.length && !running) return null
  return (
    <div className="run">
      {total > 0 && (
        <div className="plan">
          <div className="plan-head">
            <ListChecks size={14} /> Plano
            <span className="plan-count">
              {done}/{total}
            </span>
          </div>
          {t.todos.map((x, i) => (
            <div key={i} className={`todo ${x.status}`}>
              {x.status === 'completed' ? (
                <CircleCheck size={14} />
              ) : x.status === 'in_progress' ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Circle size={14} />
              )}
              <span>{x.text}</span>
            </div>
          ))}
        </div>
      )}
      {t.steps.length > 0 && (
        <details className="steps">
          <summary>
            <ChevronRight size={13} className="chev" />
            {t.steps.length} {t.steps.length === 1 ? 'ação' : 'ações'}
            {running && t.note ? <span className="steps-now"> · {t.note}</span> : null}
          </summary>
          <ul>
            {t.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </details>
      )}
      {running && total === 0 && (
        <div className="working">
          <Loader2 size={14} className="spin" /> {t.note ?? 'Trabalhando…'}
        </div>
      )}
    </div>
  )
}

export function Chat(props: Props) {
  const { project, thread, onBack, terminalOpen, onToggleTerminal, onOpenThread } = props
  const term = terminalAccess(project)
  const canTerminal = term === 'local'
  const [dropping, setDropping] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const messages = thread ? thread.messages : project.messages

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [project.id, thread?.id, messages.length, thread?.todos, thread?.steps.length, project.busy])

  // the run panel sits right after the last prompt (objective or follow-up) of the thread
  let panelAt = -1
  if (thread) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].author !== 'agent' && messages[i].author !== 'system') {
        panelAt = i
        break
      }
    }
  }

  const offline = project.machine?.online === false ? `${project.machine.name} está offline` : undefined
  const target = thread ? `a thread “${thread.title}”` : `o coordenador do ${project.name}`

  return (
    <main
      className={`chat${dropping ? ' dropping' : ''}`}
      onDragOver={(e) => {
        if (offline || ![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={(e) => {
        setDropping(false)
        const f = filesOf(e.dataTransfer)
        if (!f.length) return
        e.preventDefault()
        if (offline) return
        props.onAddFiles(f)
      }}
    >
      {dropping && (
        <div className="drop-hint" aria-hidden>
          <Paperclip size={22} /> Solte para anexar
        </div>
      )}
      <header className="chat-header">
        {term === 'remote' && (
          <button
            className="icon-btn term-toggle soon"
            aria-disabled="true"
            aria-label="Terminal remoto (em breve)"
            title="Terminal remoto (em breve)"
          >
            <SquareTerminal size={17} />
          </button>
        )}
        {canTerminal && (
          <button
            className={`icon-btn term-toggle${terminalOpen ? ' on' : ''}`}
            onClick={onToggleTerminal}
            aria-label={terminalOpen ? 'Esconder terminal' : 'Abrir terminal'}
            aria-pressed={terminalOpen}
            title={`Terminal na pasta do projeto (⌃\`)`}
          >
            <SquareTerminal size={17} />
          </button>
        )}
        {thread ? (
          <>
            <button className="back" onClick={onBack}>
              <ArrowLeft size={13} /> Coordenador
            </button>
            <h1>{thread.title}<MachineChip machine={props.showMachine ? project.machine : undefined} /></h1>
            <ThreadMetaChips thread={thread} projectId={project.id} connectorNames={props.connectorNames} />
          </>
        ) : (
          <>
            <h1>{project.name}<MachineChip machine={props.showMachine ? project.machine : undefined} /></h1>
            <p>Terminal do coordenador{project.path ? ` · ${project.path}` : ''}</p>
          </>
        )}
      </header>

      <div className="chat-scroll">
        {messages.length === 0 && (
          <p className="empty">Nenhum pedido ainda. Descreva o que o coordenador deve fazer em {project.name}.</p>
        )}
        {messages.map((m, i) => (
          <div key={m.id} className="row">
            <MessageView m={m} agent={thread?.agent} thread={thread} project={project} onOpenThread={onOpenThread} />
            {thread && i === panelAt && <RunPanel t={thread} />}
          </div>
        ))}
        {thread && !project.demo && project.path && thread.files?.length ? (
          <div className="pad">
            <ArtifactCards projectId={project.id} files={thread.files} />
          </div>
        ) : null}
        {thread && <ThreadAttention t={thread} projectId={project.id} machine={project.machine} onOpenThread={onOpenThread} />}
        {thread && !project.demo && <ThreadReportButton key={`${thread.id}:${thread.runAt}`} t={thread} projectId={project.id} />}
        {!thread && project.busy && (
          <div className="working pad">
            <Loader2 size={14} className="spin" /> O coordenador está pensando…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <Composer
        projectId={project.id}
        target={target}
        draft={props.draft}
        onDraft={props.onDraft}
        files={props.files}
        onAddFiles={props.onAddFiles}
        onRemoveFile={props.onRemoveFile}
        onMarked={props.onMarked}
        sending={props.sending}
        error={props.sendError}
        onSend={props.onSend}
        offline={offline}
      />
      {canTerminal && terminalOpen && <TerminalPanel projectId={project.id} path={project.path} onClose={onToggleTerminal} />}
    </main>
  )
}
