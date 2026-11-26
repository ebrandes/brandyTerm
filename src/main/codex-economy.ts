// What this machine allows BrandyTerm to inject into a Codex run, and why not when it can't.
// The same answer feeds the run's command line and the health check. Reads only.
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { codexHooks, findEconomizer, missingEconomizerFiles, type CodexInjection } from './adapters/codex-hooks.ts'
import { resolveCli, type ResolvedCli } from './adapters/proc.ts'
import type { RunOpts } from './adapters/types.ts'
import { diagLogOnChange } from './diag-log.ts'
import { codexRtkHook, type CodexHook } from './tool-health.ts'

/** per-run hooks and trust records were verified from this version on */
const MIN_CODEX = [0, 171, 0]

export interface Machine {
  platform: NodeJS.Platform
  /** output of `codex --version` */
  codexVersion: string | null
  python: boolean
  /** the user installed the TokenEconomizer in Codex itself: injecting would run it twice */
  userPlugin: boolean
  rtkBin: string | null
  /** the user's own RTK hook in ~/.codex */
  rtkHook: CodexHook
}

function versionProblem(text: string | null): string | null {
  const found = /(\d+)\.(\d+)\.(\d+)/.exec(text ?? '')
  const parts = found?.slice(1).map(Number)
  const diff = parts && MIN_CODEX.map((min, i) => parts[i] - min).find((d) => d)
  if (parts && (diff ?? 0) >= 0) return null
  return `Codex ${found?.[0] ?? 'de versão desconhecida'} sem hooks por execução verificados: atualize para ${MIN_CODEX.join('.')} ou mais novo`
}

export const supportsHooks = (m: Machine): boolean => !versionProblem(m.codexVersion)

/** Why Codex threads would run without the TokenEconomizer; `null` when it is injected. */
export function economizerProblem(pluginDir: string | undefined, m: Machine): string | null {
  const version = versionProblem(m.codexVersion)
  if (version) return version
  if (!pluginDir || missingEconomizerFiles(pluginDir).length) return 'plugin incompleto: rode npm run plugins'
  if (!m.python) return 'Python 3.10+ não encontrado no PATH'
  if (m.userPlugin) return 'instalado no próprio Codex, o BrandyTerm não injeta por cima: confira a aprovação em /hooks'
  return null
}

export function planInjection(run: Pick<RunOpts, 'tools' | 'plugins'>, m: Machine): CodexInjection {
  if (!supportsHooks(m)) return { args: [], env: {} }
  const dir = findEconomizer(run.plugins)
  return codexHooks({
    pluginRoot: dir && !economizerProblem(dir, m) ? dir : null,
    rtkBin: run.tools !== 'none' && m.rtkHook !== 'approved' ? m.rtkBin : null,
    platform: m.platform
  })
}

/** The interpreter the plugin's hook would use: `python` on Windows, te-hook's search elsewhere. */
export function findPython(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, probe: (name: string) => boolean): boolean {
  if (platform === 'win32') return probe('python')
  if (env.TE_PYTHON) return probe(env.TE_PYTHON)
  return ['python3', ...[15, 14, 13, 12, 11, 10].map((v) => `python3.${v}`), 'python'].some(probe)
}

const goodPython = new Set<string>()

/** only successes are remembered, so installing Python shows up on the next check */
function probePython(name: string): boolean {
  const cli = name.includes('/') ? { cmd: name, prefix: [] } : resolveCli(name)
  if (!cli) return false
  const key = [cli.cmd, ...cli.prefix].join(' ')
  if (goodPython.has(key)) return true
  try {
    execFileSync(cli.cmd, [...cli.prefix, '-c', 'import sys;sys.exit(sys.version_info<(3,10))'], { timeout: 5000, stdio: 'ignore', windowsHide: true })
    goodPython.add(key)
    return true
  } catch {
    return false
  }
}

const versions = new Map<string, string>()

/** cached until the binary changes (a Codex update) */
function versionOfSync(cli: ResolvedCli): string | null {
  try {
    const key = `${cli.cmd}:${statSync(cli.prefix[0] ?? cli.cmd).mtimeMs}`
    let v = versions.get(key)
    if (!v) {
      v = execFileSync(cli.cmd, [...cli.prefix, '--version'], { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).toString().trim()
      versions.set(key, v)
    }
    return v
  } catch {
    return null
  }
}

const codexDir = () => process.env.CODEX_HOME || join(homedir(), '.codex')

/** The config holds secrets: only this answer leaves the function. */
export function userHasEconomizer(home: string = codexDir()): boolean {
  let toml: string
  try {
    toml = readFileSync(join(home, 'config.toml'), 'utf8')
  } catch {
    return false
  }
  return toml.split(/^(?=\s*\[)/m).some((t) => /^\s*\[plugins\.["']tokeneconomizer@/.test(t) && !/^\s*enabled\s*=\s*false/m.test(t))
}

/** The `-c` pairs and environment one Codex run gets. */
export function codexEconomy(run: Pick<RunOpts, 'tools' | 'plugins'>): CodexInjection {
  const m = readMachine()
  if (!m) return { args: [], env: {} }
  const dir = findEconomizer(run.plugins)
  const problem = dir ? economizerProblem(dir, m) : null
  if (problem) diagLogOnChange('codex:economy', 'plugins', 'warn', 'TokenEconomizer não injetado no Codex', { problem })
  return planInjection(run, m)
}

/** `null` when Codex is not installed. */
export function readMachine(): Machine | null {
  const cli = resolveCli('codex')
  if (!cli) return null
  return {
    platform: process.platform,
    codexVersion: versionOfSync(cli),
    python: findPython(process.platform, process.env, probePython),
    userPlugin: userHasEconomizer(),
    rtkBin: resolveCli('rtk')?.cmd ?? null,
    rtkHook: codexRtkHook()
  }
}
