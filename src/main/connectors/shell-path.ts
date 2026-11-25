// A Finder-launched app has a bare PATH; stdio connectors (npx, railway, uvx) need the login shell's.
import { execFile } from 'node:child_process'
import os from 'node:os'

export interface PathOpts {
  run?: () => Promise<string>
  platform?: NodeJS.Platform
  envPath?: string
  home?: string
}

export function mergePath(...lists: string[][]): string {
  const seen = new Set<string>()
  for (const l of lists) for (const p of l) if (p) seen.add(p)
  return [...seen].join(':')
}

function shellRunner(): Promise<string> {
  const shell = process.env.SHELL || '/bin/zsh'
  return new Promise((resolve, reject) => {
    execFile(shell, ['-ilc', 'printf %s "$PATH"'], { timeout: 5000 }, (err, out) => (err ? reject(err) : resolve(out)))
  })
}

let cached: Promise<string> | undefined

export function resetShellPathCache(): void {
  cached = undefined
}

/** The PATH to give stdio connectors. Resolved once; on Windows process.env.PATH unchanged. */
export function loginPath(o: PathOpts = {}): Promise<string> {
  const envPath = o.envPath ?? process.env.PATH ?? ''
  if ((o.platform ?? process.platform) === 'win32') return Promise.resolve(envPath)
  cached ??= (async () => {
    let login: string[] = []
    try { login = (await (o.run ?? shellRunner)()).trim().split(':') } catch { /* fall back below */ }
    const home = o.home ?? os.homedir()
    return mergePath(envPath.split(':'), login, ['/opt/homebrew/bin', '/usr/local/bin', `${home}/.local/bin`])
  })()
  return cached
}
