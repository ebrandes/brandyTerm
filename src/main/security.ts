import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { claudeAdapter } from './adapters/claude.ts'
import { runOnce } from './run.ts'
import { diagLog } from './diag-log.ts'
import { inside } from './paths.ts'

/**
 * Security gate for plugin installs: the plugin's source is fetched into a
 * throwaway folder without enabling it, then claude-security scans it from
 * outside (the copy sits in `alvo/`, so its `.claude/` settings and hooks never
 * load). Bash runs inside Claude Code's sandbox, writable only in that folder.
 */

export interface ScanResult {
  ok: boolean
  counts: Record<string, number>
  /** CRITICAL or HIGH findings, or no report at all: install waits for the user */
  blocked: boolean
  report?: string
  error?: string
}

const SCAN_TIMEOUT_MS = 30 * 60 * 1000
const git = (args: string[], cwd: string) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()

/** Copies (or clones) the source of `name@marketplace` into `<dir>/alvo`, as the marketplace lists it. */
function fetchSource(spec: string, dir: string): void {
  const [name, market] = spec.split('@')
  const mdir = join(homedir(), '.claude', 'plugins', 'marketplaces', market ?? '')
  const manifest = join(mdir, '.claude-plugin', 'marketplace.json')
  if (!market || !existsSync(manifest)) throw new Error(`marketplace ${market} não encontrado`)
  const entry = (JSON.parse(readFileSync(manifest, 'utf8')).plugins ?? []).find((p: { name: string }) => p.name === name)
  if (!entry) throw new Error(`${name} não está no marketplace ${market}`)
  const target = join(dir, 'alvo')
  const src = entry.source
  if (typeof src === 'string') {
    const from = resolve(mdir, src)
    // realpath: a symlink inside the marketplace must not point outside it; the marketplace root itself is a valid source ("./")
    const real = existsSync(from) ? realpathSync(from) : ''
    const root = realpathSync(mdir)
    if (!real || (real !== root && !inside(root, real))) throw new Error('fonte do plugin fora do marketplace')
    cpSync(from, target, { recursive: true, filter: (s) => !s.split(/[\\/]/).includes('.git') })
    return
  }
  const url = src?.url ?? (src?.repo ? `https://github.com/${src.repo}.git` : undefined)
  if (!url) throw new Error('fonte do plugin não suportada')
  const tmp = mkdtempSync(join(tmpdir(), 'brandyterm-src-'))
  try {
    git(['init', '-q'], tmp)
    git(['remote', 'add', 'origin', url], tmp)
    git(['fetch', '-q', '--depth', '1', 'origin', src.sha ?? src.ref ?? 'HEAD'], tmp)
    git(['checkout', '-q', 'FETCH_HEAD'], tmp)
    cpSync(join(tmp, src.path ?? '.'), target, { recursive: true, filter: (s) => !s.split(/[\\/]/).includes('.git') })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function readReport(dir: string): { counts: Record<string, number>; report: string } | null {
  const out = readdirSync(dir).find((d) => d.startsWith('CLAUDE-SECURITY-'))
  if (!out) return null
  const jsonl = join(dir, out, 'CLAUDE-SECURITY-RESULTS.jsonl')
  const report = join(dir, out, 'CLAUDE-SECURITY-RESULTS.md')
  // both files are required: a report without results means the scan did not finish
  if (!existsSync(report) || !existsSync(jsonl)) return null
  const counts: Record<string, number> = {}
  const lines = readFileSync(jsonl, 'utf8').split('\n').filter(Boolean)
  for (const line of lines) {
    try {
      const sev = String(JSON.parse(line).severity ?? 'UNKNOWN').toUpperCase()
      counts[sev] = (counts[sev] ?? 0) + 1
    } catch {
      counts.UNKNOWN = (counts.UNKNOWN ?? 0) + 1
    }
  }
  return { counts, report }
}

const PROMPT = `/claude-security scan the codebase, scoped to the alvo/ directory, at low scan effort. I accept the time and token cost; do not ask me anything. This is a third-party Claude Code plugin about to be installed: besides vulnerabilities, look for malicious behavior (exfiltration, hidden network calls, credential or token access, destructive or obfuscated commands in hooks, scripts and MCP server configs).`

function failedScan(spec: string, error: string): ScanResult {
  diagLog('plugins', 'error', 'scan de segurança falhou', { spec, error })
  return { ok: false, counts: {}, blocked: true, error }
}

/** Runs claude-security over `<dir>/alvo`, which the caller already filled. `label` names it in the logs. */
async function scanPrepared(dir: string, label: string, scanner: string): Promise<ScanResult> {
  git(['init', '-q'], dir)
  git(['add', '-A'], dir)
  git(['-c', 'user.email=scan@brandyterm', '-c', 'user.name=BrandyTerm', 'commit', '-qm', 'alvo'], dir)
  const { handle, result } = runOnce(claudeAdapter, { cwd: dir, prompt: PROMPT, model: 'opus', tools: 'scan', plugins: [scanner] })
  const timer = setTimeout(() => handle.cancel(), SCAN_TIMEOUT_MS)
  const r = await result.finally(() => clearTimeout(timer))
  if (!r.done?.ok) return failedScan(label, r.done?.error ?? 'o scan não terminou')
  const found = readReport(dir)
  if (!found) return failedScan(label, r.done?.error ?? 'o scan terminou sem relatório')
  // keep the report next to the app's data; the scanned copy is deleted
  const keep = mkdtempSync(join(tmpdir(), 'brandyterm-report-'))
  cpSync(found.report, join(keep, 'CLAUDE-SECURITY-RESULTS.md'))
  // a finding the app could not read counts as serious
  const blocked = (found.counts.CRITICAL ?? 0) + (found.counts.HIGH ?? 0) + (found.counts.UNKNOWN ?? 0) > 0
  return { ok: true, counts: found.counts, blocked, report: join(keep, 'CLAUDE-SECURITY-RESULTS.md') }
}

/** Fetches `<dir>/alvo` with `fill`, scans it and always removes the throwaway folder. */
async function scanWith(label: string, scanner: string, fill: (dir: string) => void): Promise<ScanResult> {
  const dir = mkdtempSync(join(tmpdir(), 'brandyterm-scan-'))
  try {
    fill(dir)
    return await scanPrepared(dir, label, scanner)
  } catch (err) {
    return failedScan(label, (err as Error).message)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Scans the plugin `spec` with claude-security. `scanner` is the claude-security plugin dir. */
export function scanPlugin(spec: string, scanner: string): Promise<ScanResult> {
  return scanWith(spec, scanner, (dir) => fetchSource(spec, dir))
}

/** Scans a local folder (a staged skill) the same way: copied into `alvo/`, `.git` left out. */
export function scanDir(src: string, scanner: string): Promise<ScanResult> {
  return scanWith(src, scanner, (dir) => {
    if (!existsSync(src)) throw new Error(`pasta ${src} não encontrada`)
    cpSync(src, join(dir, 'alvo'), { recursive: true, filter: (s) => !s.split(/[\\/]/).includes('.git') })
  })
}

export function describeCounts(counts: Record<string, number>): string {
  const order = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
  const parts = order.filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`)
  return parts.length ? parts.join(', ') : 'nenhum achado'
}
