import type { UpdateNotice, UpdateStatus } from '../../shared/update.ts'

export const versionTitle = (s: UpdateStatus): string =>
  `BrandyTerm v${s.version}${s.commit ? ` · commit ${s.commit}` : ''}`

export function noticeTitle(n: UpdateNotice): string {
  if (n.kind === 'release') return `Versão v${n.version} disponível: abrir a página no navegador`
  return `${n.behind} ${n.behind === 1 ? 'commit' : 'commits'} atrás de origin/main`
}

export const terminalName = (platform: string): string =>
  platform === 'win32' ? 'PowerShell' : platform === 'darwin' ? 'Terminal' : 'terminal'
