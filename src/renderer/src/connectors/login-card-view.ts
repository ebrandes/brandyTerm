// What a login card shows for a login and a viewer. Pure.
import type { PanelLogin } from '../../../shared/connectors.ts'

export interface LoginCardView {
  title: string
  primary?: { label: string; disabled: boolean }
  cancel: boolean
  note?: string
  showTerminal: boolean
  showFields: boolean
}

export function loginCardView(login: PanelLogin, remote: boolean, machineName?: string): LoginCardView {
  const title = `Conectar ${login.name}`
  const showTerminal = login.authKind === 'cli' && login.phase === 'waiting'
  if (remote) {
    return { title, primary: { label: `Faça login em ${machineName ?? 'outra máquina'}`, disabled: true }, cancel: false, showTerminal: false, showFields: false }
  }
  if (login.phase === 'waiting') return { title, note: 'Aguardando login…', cancel: true, showTerminal, showFields: false }
  if (login.phase === 'failed') {
    return { title, note: login.error, primary: { label: 'Tentar de novo', disabled: false }, cancel: true, showTerminal: false, showFields: login.authKind === 'token' }
  }
  return { title, primary: { label: 'Entrar', disabled: false }, cancel: true, showTerminal: false, showFields: login.authKind === 'token' }
}
