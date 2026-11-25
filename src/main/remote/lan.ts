import type os from 'node:os'

type Ifaces = ReturnType<typeof os.networkInterfaces>

// Virtual, tunnel, VPN and point-to-point interfaces: not the local network.
const SKIP_NAME = /^(lo|utun|ppp|tun|tap|awdl|llw|docker|veth|br-|vmnet|vboxnet|wg|ipsec|fortissl|forticlient)/i
// Adapter descriptions (Windows, see adapters.ts) that mark a VPN whatever the interface is called.
const SKIP_DESCRIPTION = /fortinet/i

const strip = (a: string | undefined): string => (a ?? '').replace(/^::ffff:/i, '')

/** 10/8, 172.16/12 or 192.168/16. */
export function isPrivateIPv4(addr: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr)
  if (!m) return false
  const p = m.slice(1).map(Number)
  if (p.some(n => n > 255)) return false
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168)
}

/** Private IPv4 addresses of real LAN interfaces. `descriptions`: interface name → adapter description. */
export function lanAddresses(ifaces: Ifaces, descriptions: Record<string, string> = {}): string[] {
  const out: string[] = []
  for (const [name, list] of Object.entries(ifaces)) {
    if (SKIP_NAME.test(name) || SKIP_DESCRIPTION.test(descriptions[name] ?? '')) continue
    for (const a of list ?? []) {
      if (a.internal || a.family !== 'IPv4' || !isPrivateIPv4(a.address)) continue
      out.push(a.address)
    }
  }
  return out
}

/** Connection filter: the connection came in on a LAN interface from a private IPv4 peer. */
export function acceptLan(
  ifaces: Ifaces, local: string | undefined, remote: string | undefined, descriptions: Record<string, string> = {}
): boolean {
  return lanAddresses(ifaces, descriptions).includes(strip(local)) && isPrivateIPv4(strip(remote))
}
