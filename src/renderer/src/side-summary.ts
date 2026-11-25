/** Short texts for the sidebar section headers and account cards. */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "Agentes" header: how many are installed. */
export const readyLabel = (installed: number) => plural(installed, 'pronto', 'prontos')

/** One-line account usage, e.g. "5h 2% · sem 1%"; the reset time goes to the tooltip. */
export const usageLine = (five: number | undefined, week: number) => `5h ${five ?? 0}% · sem ${week}%`

/** "Acesso remoto" header: what the server really does. */
export function remoteLabel(enabled: boolean, state: 'off' | 'on' | 'failed'): string {
  if (!enabled) return 'desligado'
  return state === 'failed' ? 'falhou' : state === 'on' ? 'ligado' : 'iniciando…'
}
