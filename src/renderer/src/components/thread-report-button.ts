import { summarySent } from '../../../shared/thread-report-state.ts'
import type { Thread } from '../../../shared/types.ts'

export type ReportButtonState = 'hidden' | 'disabled' | 'busy' | 'ready' | 'sent' | 'error'

export function reportButtonState(t: Thread): ReportButtonState {
  if (t.state !== 'done' || t.retired) return 'hidden'
  if (t.reporting) return 'busy'
  if (summarySent(t)) return 'sent'
  if (!t.sessionId) return 'disabled'
  return t.reportError ? 'error' : 'ready'
}

/** what only the window knows: a click still waiting for an answer, or one that was refused */
export interface ReportClick {
  pending?: boolean
  error?: string
}

export interface ReportButtonView {
  state: ReportButtonState
  label: string
  inactive: boolean
  title?: string
  error?: string
}

const LABELS: Record<ReportButtonState, string> = {
  hidden: '',
  disabled: 'Enviar resumo ao coordenador',
  busy: 'Enviando…',
  ready: 'Enviar resumo ao coordenador',
  sent: 'Enviado ao coordenador ✓',
  error: 'Tentar novamente'
}

function sentAt(iso: string): string {
  const at = new Date(iso)
  return `Enviado em ${at.toLocaleDateString('pt-BR')} às ${at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

const cleanError = (text: string): string => text.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

export function reportButtonView(t: Thread, click: ReportClick = {}): ReportButtonView {
  let state = reportButtonState(t)
  if (state === 'ready' || state === 'error') {
    if (click.pending) state = 'busy'
    else if (click.error) state = 'error'
  }
  const error = state === 'error' ? `Não foi enviado: ${cleanError(click.error ?? t.reportError!)}` : undefined
  const title =
    state === 'sent' ? sentAt(t.reportedAt!) : state === 'disabled' ? 'A thread ainda não conversou' : undefined
  return { state, label: LABELS[state], inactive: state === 'busy' || state === 'sent' || state === 'disabled', title, error }
}
