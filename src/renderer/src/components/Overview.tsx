import { LayoutGrid } from 'lucide-react'
import { projectTokens, type Project, type Thread } from '../types'
import { ThreadCard } from './ThreadCard'
import { ResolvedGroup } from './ResolvedGroup'
import { ProcessPanel } from './ProcessPanel'
import { contextLabel, formatTokens } from '../health'
import { coordinatorLimit, coordinatorWarn, rotateAt } from '../../../shared/context-limit.ts'
import { api } from '../api'
import { report } from '../notice'
import './overview-footer.css'


interface Props {
  project: Project
  selectedId?: string
  onSelect: (id: string) => void
  onCancel: (id: string) => void
  onBoard: () => void
  /** app setting: new threads start with "permitir tudo" */
  allowAllThreads: boolean
  /** app setting: keep the machine awake while work runs */
  keepAwake: boolean
  /** app setting: compact an idle coordinator's context */
  idleCompact: boolean
}

export function Overview({ project, selectedId, onSelect, onCancel, onBoard, allowAllThreads, keepAwake, idleCompact }: Props) {
  const count = (s: Thread['state']) => project.threads.filter((t) => t.state === s).length
  const parts: string[] = []
  if (count('running')) parts.push(`${count('running')} em execução`)
  const asking = project.threads.filter((t) => t.state === 'waiting' || t.approval).length
  if (asking) parts.push(`${asking} aguardando você`)
  if (count('queued')) parts.push(`${count('queued')} em fila`)
  const pending = project.threads.filter((t) => t.state === 'done' && t.pending).length
  if (pending) parts.push(`${pending} ${pending === 1 ? 'pendente' : 'pendentes'}`)
  const resolvedCount = project.threads.filter((t) => t.state === 'done' && !t.pending).length
  if (resolvedCount) parts.push(`${resolvedCount} ${resolvedCount === 1 ? 'resolvida' : 'resolvidas'}`)
  const threads = [...project.threads].reverse()
  // auto-resolve: finished threads with nothing pending fold away; pending ones stay in view
  const resolved = threads.filter((t) => t.state === 'done' && t.resolved)
  const active = threads.filter((t) => !(t.state === 'done' && t.resolved))
  const saved = project.coordinator.context
  // old saves carry the model's 1M window: the coordinator is held to its own ceiling
  const coordCtx = saved && saved.used > 0 ? { used: saved.used, limit: coordinatorLimit(saved.limit) } : undefined
  const measured = project.coordinator.usage.measured || !!project.archived?.usage.measured || project.threads.some((t) => t.usage.measured)

  return (
    <aside className="overview" id="overview">
      <header className="overview-header">
        <div className="overview-title">
          <h2>Visão do projeto</h2>
          <button className="icon-btn" onClick={onBoard} aria-label="Abrir quadro dos agentes" title="Quadro dos agentes (⌘B)">
            <LayoutGrid size={15} />
          </button>
        </div>
        <p>{parts.length ? parts.join(' · ') : 'Sem atividade'}</p>
      </header>

      <div className="thread-list">
        {threads.length === 0 && (
          <p className="empty small">As threads criadas pelo coordenador aparecem aqui. Clique em uma para falar direto com ela.</p>
        )}
        {active.length > 0 && (
          <div className="tcard-grid">
            {active.map((t) => (
              <ThreadCard key={t.id} t={t} project={project} selected={t.id === selectedId} onSelect={onSelect} onCancel={onCancel} />
            ))}
          </div>
        )}
        {resolved.length > 0 && (
          // key: remounts (and folds) the group whenever the user enters another project
          <ResolvedGroup key={project.id} project={project} threads={resolved} selectedId={selectedId} onSelect={onSelect} onCancel={onCancel} />
        )}
      </div>

      <ProcessPanel project={project} />

      <footer className="overview-footer">
        {coordCtx && (
          <div
            className="overview-footer-row"
            title={`Contexto do coordenador: sessão atual, limitada a ${formatTokens(coordCtx.limit)}. Ele troca de sessão sozinho a cada 20 mensagens ou ao passar de ${formatTokens(rotateAt(coordCtx.limit))}, e a memória do projeto carrega o que importa`}
          >
            <span>Contexto</span>
            <strong className={coordinatorWarn(coordCtx.used, coordCtx.limit) ? 'warn' : undefined}>{contextLabel(coordCtx)}</strong>
          </div>
        )}
        {!project.machine?.remote && !project.demo && (
          <label className="overview-footer-row" title="Quando desligado, os computadores pareados não veem este projeto nem leem arquivos dele">
            <span>Disponível remotamente</span>
            <input
              type="checkbox"
              checked={!project.remoteHidden}
              onChange={(e) => void api.setRemoteHidden({ projectId: project.id, hidden: !e.target.checked }).catch(report)}
            />
          </label>
        )}
        <label className="overview-footer-row" title="Threads novas (em qualquer projeto) já começam com permitir tudo: não pedem aprovação de comandos e edições. Fica salvo no app; as threads atuais seguem o que você escolher em cada uma">
          <span>Threads novas: permitir tudo</span>
          <input type="checkbox" checked={allowAllThreads} onChange={(e) => void api.setSettings({ allowAllThreads: e.target.checked })} />
        </label>
        <label className="overview-footer-row" title="Enquanto uma thread ou o coordenador estiver trabalhando, o computador não entra em repouso. Com a tampa do MacBook fechada, ele ainda dorme se não houver monitor externo">
          <span>Manter acordado enquanto trabalha</span>
          <input type="checkbox" checked={keepAwake} onChange={(e) => void api.setSettings({ keepAwake: e.target.checked })} />
        </label>
        <label className="overview-footer-row" title="Quando o coordenador fica parado por alguns minutos, o contexto dele é compactado sozinho (como o /compact), para a próxima mensagem começar menor e mais barata">
          <span>Compactar coordenador ocioso</span>
          <input type="checkbox" checked={idleCompact} onChange={(e) => void api.setSettings({ idleCompact: { enabled: e.target.checked, minutes: 4, minTokens: 40_000 } })} />
        </label>
        <div className="overview-footer-row" title="Tokens gastos no projeto. Soma de tudo que o coordenador e as threads já gastaram neste projeto (entrada nova e saída; leitura de cache não conta)">
          <span>Tokens do projeto{measured ? '' : ' (sem medição)'}</span>
          <strong>{formatTokens(projectTokens(project))}</strong>
        </div>
      </footer>
    </aside>
  )
}
