// Validation of a custom or imported connector, shared by the form (renderer) and main. Pure.
export interface CustomDraft {
  name: string
  transport: 'stdio' | 'http'
  command: string
  url: string
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The first problem with a custom connector, in pt-BR, or null when it can be saved. */
export function validateCustom(d: CustomDraft): string | null {
  if (!d.name.trim()) return 'Informe o nome'
  if (d.transport === 'stdio') return d.command.trim() ? null : 'Informe o comando'
  if (!d.url.trim()) return 'Informe a URL'
  try {
    const u = new URL(d.url.trim())
    if (u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname))) return null
  } catch { /* falls through */ }
  return 'Use uma URL https'
}
