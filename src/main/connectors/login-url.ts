// Which authorization URLs an OAuth login may open. The server the user added picks the URL, so only web
// addresses pass: file:, UNC paths and app schemes would reach the OS's URL handler (CVE-2025-6514's class).

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Why `href` must not be opened, or null when it may: https, or http to this machine. */
export function loginUrlProblem(href: string): string | null {
  let u: URL
  try {
    u = new URL(href)
  } catch {
    return 'Endereço de login inválido: ?'
  }
  if (u.protocol === 'https:') return null
  if (u.protocol === 'http:' && LOOPBACK.has(u.hostname)) return null
  return `Endereço de login inválido: ${u.protocol.replace(/:$/, '')}`
}
