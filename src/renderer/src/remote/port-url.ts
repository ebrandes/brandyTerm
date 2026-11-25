// The address to reach a port of a paired machine from this one. Pure.

/** `ip:port` / `[v6]:port` / bare host → the host part, or null. */
export function hostOfAddress(address: string | undefined): string | null {
  const a = (address ?? '').trim()
  if (!a) return null
  const v6 = /^\[([^\]]+)\](?::\d+)?$/.exec(a)
  if (v6) return v6[1]
  const i = a.lastIndexOf(':')
  const host = i > 0 && !a.slice(0, i).includes(':') ? a.slice(0, i) : a
  return host || null
}

export function portUrl(address: string | undefined, port: number): string | null {
  const host = hostOfAddress(address)
  if (!host) return null
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`
}
