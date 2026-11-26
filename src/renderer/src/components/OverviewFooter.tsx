import { projectTokens, type ContextUse, type Project } from '../types'
import { contextLabel, formatTokens } from '../health'
import { coordinatorWarn, rotateAt } from '../../../shared/context-limit.ts'
import { api } from '../api'
import { report } from '../notice'
import './overview-footer.css'

// what the switch really does: listing and the app's file calls, not what a visible project's coordinator can reach
const REMOTE_TIP =
  'Desligado: os computadores pareados não veem este projeto nem abrem arquivos dele pelo app. ' +
  'Se um projeto visível contém esta pasta, o coordenador e os comandos de lá ainda alcançam os arquivos'

const notifyTip = (platform: string) =>
  'Avisa quando uma thread ou o coordenador termina, falha ou espera você, se você não estiver olhando para ela. ' +
  (platform === 'darwin'
    ? 'Se nada aparecer, libere em Ajustes do Sistema > Notificações (rodando do código, o app aparece como Electron)'
    : 'Se nada aparecer, confira Configurações > Sistema > Notificações e o modo Não incomodar do Windows')

export interface FooterProps {
  project: Project
  /** coordinator context, already clamped to its ceiling */
  context: ContextUse | undefined
  hidden: boolean
  /** app setting: new threads start with "permitir tudo" */
  allowAllThreads: boolean
  /** app setting: keep the machine awake while work runs */
  keepAwake: boolean
  /** app setting: native notifications */
  notifications: boolean
  /** app setting: compact an idle coordinator's context */
  idleCompact: boolean
  /** remote access is on or another machine is paired (showRemoteToggle) */
  showRemote: boolean
}

export function OverviewFooter({ project, context, hidden, allowAllThreads, keepAwake, notifications, idleCompact, showRemote }: FooterProps) {
  const measured = project.coordinator.usage.measured || !!project.archived?.usage.measured || project.threads.some((t) => t.usage.measured)
  return (
    <footer className="overview-footer" id="dock-footer" hidden={hidden}>
      {context && (
        <div
          className="overview-footer-row"
          title={`Contexto do coordenador: sessão atual, limitada a ${formatTokens(context.limit)}. Ele troca de sessão sozinho a cada 20 mensagens ou ao passar de ${formatTokens(rotateAt(context.limit))}, e a memória do projeto carrega o que importa`}
        >
          <span>Contexto</span>
          <strong className={coordinatorWarn(context.used, context.limit) ? 'warn' : undefined}>{contextLabel(context)}</strong>
        </div>
      )}
      {showRemote && !project.machine?.remote && !project.demo && (
        <label className="overview-footer-row" title={REMOTE_TIP}>
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
      <label className="overview-footer-row" title={notifyTip(api.platform)}>
        <span>Notificações</span>
        <input type="checkbox" checked={notifications} onChange={(e) => void api.setSettings({ notifications: e.target.checked })} />
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
  )
}
