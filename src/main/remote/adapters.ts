// Network adapter descriptions (Windows only): a Fortinet VPN adapter can carry a plain name such as
// "Ethernet 3", so the LAN rule also looks at what the adapter is. Node does not expose descriptions; the
// host loads them once per server start and the LAN rule reads the cached map. Elsewhere the map is empty.
import { execFile } from 'node:child_process'

type Run = (file: string, args: string[], done: (err: Error | null, stdout: string) => void) => void

const QUERY = 'Get-NetAdapter -IncludeHidden | Select-Object Name,InterfaceDescription | ConvertTo-Json -Compress'

let cache: Record<string, string> = {}

/** interface name → adapter description, as last loaded */
export const adapterDescriptions = (): Record<string, string> => cache

/** Parses ConvertTo-Json output: one object, or an array of them. Anything else: empty. */
export function parseAdapters(json: string): Record<string, string> {
  const out: Record<string, string> = {}
  let v: unknown
  try { v = JSON.parse(json) } catch { return out }
  for (const a of Array.isArray(v) ? v : [v]) {
    const { Name, InterfaceDescription } = (a ?? {}) as { Name?: unknown; InterfaceDescription?: unknown }
    if (typeof Name === 'string' && typeof InterfaceDescription === 'string') out[Name] = InterfaceDescription
  }
  return out
}

const runFile: Run = (file, args, done) => {
  execFile(file, args, { timeout: 5000, windowsHide: true }, (err, stdout) => done(err, String(stdout)))
}

/** Reloads the map. Never rejects: on failure (or off Windows) the map is empty and the name rule alone applies. */
export function loadAdapterDescriptions(platform: string = process.platform, run: Run = runFile): Promise<void> {
  if (platform !== 'win32') {
    cache = {}
    return Promise.resolve()
  }
  return new Promise(resolve => {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', QUERY], (err, stdout) => {
      cache = err ? {} : parseAdapters(stdout)
      resolve()
    })
  })
}
