import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PluginInfo } from '../shared/types.ts'
import { resolveCli } from './adapters/proc.ts'
import { rtkInfo } from './rtk.ts'
import { describeCounts, scanPlugin } from './security.ts'

interface Wanted {
  id: string
  name: string
  /** `mcp` = plugin whose job is shipping an MCP server; `plugin` = skills/agents/commands */
  kind: 'plugin' | 'mcp'
  /** directory name of the plugin inside each marketplace cache folder */
  dirName: string
  /** optional plugins are only loaded after the user installs them from the sidebar */
  optional?: boolean
  /** `claude plugin install` spec used by the sidebar install button */
  spec?: string
  /** loaded only in the security scans, not in every thread */
  scanner?: boolean
}

/**
 * Plugins BrandyTerm knows about. Defaults ship with the app (resources/plugins.json,
 * fetched on npm install). Optional ones are installed on demand through Claude's
 * marketplace. Every one that is present loads in every Claude thread.
 */
const PLUGINS: Wanted[] = [
  { id: 'superpowers', name: 'Superpowers', kind: 'plugin', dirName: 'superpowers' },
  { id: 'tokeneconomizer', name: 'TokenEconomizer', kind: 'plugin', dirName: 'tokeneconomizer' },
  { id: 'claude-code-setup', name: 'Claude Code Setup', kind: 'plugin', dirName: 'claude-code-setup' },
  { id: 'claude-security', name: 'Claude Security', kind: 'plugin', dirName: 'claude-security', scanner: true },
  {
    id: 'chrome-devtools-mcp',
    name: 'Chrome DevTools MCP',
    kind: 'mcp',
    dirName: 'chrome-devtools-mcp',
    optional: true,
    spec: 'chrome-devtools-mcp@claude-plugins-official'
  },
  { id: 'ralph-loop', name: 'Ralph Loop', kind: 'plugin', dirName: 'ralph-loop', optional: true, spec: 'ralph-loop@claude-plugins-official' }
]

/** plugin names BrandyTerm already ships or installs itself */
export const OWN_PLUGIN_NAMES = new Set(PLUGINS.map((p) => p.dirName))

function cmpVersion(a: string, b: string): number {
  const pa = a.split(/[.\-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.\-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

function dirs(p: string): string[] {
  try {
    return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
}

/** Where `npm install` (scripts/fetch-plugins.mjs) puts the plugins shipped with BrandyTerm. */
function bundledRoots(): string[] {
  const roots: string[] = []
  const res = (process as { resourcesPath?: string }).resourcesPath
  if (res) roots.push(join(res, 'plugins'))
  roots.push(join(process.cwd(), 'resources', 'plugins'))
  return roots
}

function bundled(w: Wanted): { dir: string; version: string } | null {
  for (const r of bundledRoots()) {
    const dir = join(r, w.id)
    const manifest = join(dir, '.claude-plugin', 'plugin.json')
    if (!existsSync(manifest)) continue
    try {
      return { dir, version: String(JSON.parse(readFileSync(manifest, 'utf8')).version ?? 'incluído') }
    } catch {
      return { dir, version: 'incluído' }
    }
  }
  return null
}

function cached(w: Wanted): { dir: string; version: string } | null {
  const cache = join(homedir(), '.claude', 'plugins', 'cache')
  let best: { dir: string; version: string } | null = null
  for (const market of dirs(cache)) {
    for (const version of dirs(join(cache, market, w.dirName))) {
      const dir = join(cache, market, w.dirName, version)
      if (!existsSync(join(dir, '.claude-plugin', 'plugin.json'))) continue
      if (!best || cmpVersion(version, best.version) > 0) best = { dir, version }
    }
  }
  return best
}

/** Resolves each plugin: the copy bundled with BrandyTerm first, then Claude's plugin cache. */
export function discoverPlugins(): PluginInfo[] {
  const plugins = PLUGINS.map((w): PluginInfo => {
    const own = w.optional ? null : bundled(w)
    const best = own ?? cached(w)
    let note: string
    if (best && w.scanner) note = 'revisa cada plugin antes da instalação'
    else if (best) note = own ? 'incluído no BrandyTerm, carregado em todas as threads do Claude' : 'carregado em todas as threads do Claude'
    else note = w.optional ? 'opcional; clique para instalar' : 'não encontrado; rode npm run plugins'
    return { id: w.id, name: w.name, kind: w.kind, dir: best?.dir, version: best?.version, optional: !!w.optional, scanner: !!w.scanner, note }
  })
  return [...plugins, rtkInfo()]
}

export type InstallResult = { ok: boolean; error?: string; review?: PluginInfo['review'] }

/**
 * Installs an optional plugin with `claude plugin install <spec>`, after claude-security
 * scanned its source. CRITICAL/HIGH findings (or a scan without a report) stop the
 * install until the user confirms with `force`.
 */
export async function installPlugin(id: string, force = false): Promise<InstallResult> {
  const w = PLUGINS.find((p) => p.id === id)
  if (!w?.spec) return { ok: false, error: 'plugin desconhecido' }
  const cli = resolveCli('claude')
  if (!cli) return { ok: false, error: 'Claude Code não encontrado no PATH' }
  let review: PluginInfo['review']
  if (!force) {
    const scanner = discoverPlugins().find((p) => p.scanner)?.dir
    if (!scanner) return { ok: false, error: 'Claude Security ausente; rode npm run plugins antes de instalar' }
    const r = await scanPlugin(w.spec, scanner)
    review = { summary: r.ok ? describeCounts(r.counts) : `scan falhou: ${r.error}`, report: r.report, blocked: r.blocked }
    if (r.blocked) return { ok: false, review }
  }
  const done = await claudeInstall(cli, w.spec)
  return { ...done, review }
}

function claudeInstall(cli: { cmd: string; prefix: string[] }, spec: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(cli.cmd, [...cli.prefix, 'plugin', 'install', spec], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', (err) => resolve({ ok: false, error: err.message }))
    child.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: out.trim().split('\n').pop() || `saiu com código ${code}` }))
  })
}
