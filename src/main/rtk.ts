import { execFileSync } from 'node:child_process'
import type { PluginInfo } from '../shared/types.ts'
import { resolveCli } from './adapters/proc.ts'
import { readMachine, supportsHooks } from './codex-economy.ts'
import { rtkCoverage } from './tool-health.ts'

/**
 * RTK (github.com/rtk-ai/rtk) compresses shell output before the agent reads it.
 * It works through a PreToolUse hook on Bash, so BrandyTerm threads get a Bash
 * tool restricted to the read-only commands below and the hook passed per run.
 */

/** Shell commands a read-only thread may run. Anything else is denied in headless mode. */
export const READ_ONLY = ['git status', 'git diff', 'git log', 'git show', 'git blame', 'ls', 'tree', 'cat', 'head', 'tail', 'wc', 'rg', 'grep']

/** What the RTK hook rewrites those commands into (`cat`/`head` become `rtk read`). */
const RTK_FORMS = [...READ_ONLY.filter((c) => c !== 'cat' && c !== 'head').map((c) => `rtk ${c}`), 'rtk read']

export function rtkBin(): string | null {
  return resolveCli('rtk')?.cmd ?? null
}

/** `--allowedTools` rules for the read-only shell, including the rewritten forms when RTK is on. */
export function readOnlyBashRules(withRtk: boolean): string[] {
  const cmds = withRtk ? [...READ_ONLY, ...RTK_FORMS] : READ_ONLY
  return cmds.map((c) => `Bash(${c}:*)`)
}

/** `--settings` JSON that installs the RTK hook for one Claude run, independent of the user's settings. */
export function rtkSettings(bin: string, extra: object = {}): string {
  return JSON.stringify({
    ...extra,
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `"${bin}" hook claude` }] }] }
  })
}

/** Sidebar entry for RTK. `dir` holds the binary path so the row shows as active. */
export function rtkInfo(): PluginInfo {
  const bin = rtkBin()
  let version: string | undefined
  if (bin) {
    try {
      version = execFileSync(bin, ['--version'], { timeout: 5000 }).toString().trim().replace(/^rtk\s+/, '')
    } catch {
      version = 'ativo'
    }
  }
  const note = bin ? 'comprime a saída do shell antes de o agente ler' : 'não encontrado; instale com brew install rtk'
  const m = readMachine()
  const codex = m && (m.rtkHook !== 'approved' && supportsHooks(m) ? 'injected' : m.rtkHook)
  const coverage = rtkCoverage(!!bin, codex)
  return { id: 'rtk', name: 'RTK', kind: 'tool', dir: bin ?? undefined, version, note, coverage }
}
