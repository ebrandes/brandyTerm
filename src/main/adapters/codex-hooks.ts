// Per-run injection of the token-saving hooks into Codex, only through `-c` and the child's
// environment: nothing is written to ~/.codex. Codex runs a hook only when a trust record
// matches its hash, and it accepts that record from the command line too (`hooks.state`),
// so --dangerously-bypass-hook-trust (which would also run the user's unapproved hooks)
// is not needed. Mirrors codex-rs/hooks and config/src/fingerprint.rs of Codex 0.171.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const HOOKS_FILE = 'hooks/codex-hooks.json'

/** files without which the plugin does nothing in Codex */
export const ECONOMIZER_FILES = [HOOKS_FILE, 'scripts/te-hook', 'scripts/te_bootstrap.py', 'lib/tokeneconomizer/plugin/hook.py']

export const missingEconomizerFiles = (root: string): string[] => ECONOMIZER_FILES.filter((f) => !existsSync(join(root, f)))

/** The TokenEconomizer among a run's plugin dirs (the ones Claude would get with --plugin-dir). */
export function findEconomizer(dirs: string[] | undefined): string | null {
  return dirs?.find((d) => existsSync(join(d, HOOKS_FILE)) && existsSync(join(d, 'scripts', 'te-hook'))) ?? null
}

interface Handler {
  command: string
  commandWindows?: string
  timeout?: number
}
interface Group {
  matcher?: string
  hooks: Handler[]
}
type Hooks = Record<string, Group[]>

export interface CodexInjection {
  /** `-c` pairs, to go before the final `-` */
  args: string[]
  /** variables to add to the child's environment */
  env: Record<string, string>
}

/** events whose matcher Codex keeps; for the others it is left out of the hash */
const MATCHED = new Set(['PreToolUse', 'PermissionRequest', 'PostToolUse', 'SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact'])

const label = (event: string) => event.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()

/** the timeout Codex ends up with, which is the one it hashes */
function timeoutOf(event: string, t: number | undefined): number {
  return event === 'SessionEnd' || event === 'Interrupt' ? Math.min(Math.max(t ?? 1, 1), 3) : Math.max(t ?? 600, 1)
}

function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted)
  if (!v || typeof v !== 'object') return v
  return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sorted(x)]))
}

function trustHash(event: string, matcher: string | undefined, command: string, timeout: number): string {
  const identity = {
    event_name: label(event),
    ...(matcher !== undefined && MATCHED.has(event) ? { matcher } : {}),
    hooks: [{ type: 'command', command, timeout, async: false }]
  }
  return 'sha256:' + createHash('sha256').update(JSON.stringify(sorted(identity))).digest('hex')
}

/** How Codex names the file of a hook that came from `-c`. The exact separator on Windows is
 * not verified on a Windows machine, so both go: an unused trust record is ignored. */
const flagSources = (platform: NodeJS.Platform) =>
  platform === 'win32' ? ['C:\\<session-flags>\\config.toml', 'C:\\<session-flags>/config.toml'] : ['/<session-flags>/config.toml']

/** the hook list stays the plugin's own: it is read, never copied here */
function pluginHooks(root: string): Hooks {
  try {
    return JSON.parse(readFileSync(join(root, HOOKS_FILE), 'utf8')).hooks ?? {}
  } catch {
    return {}
  }
}

const str = JSON.stringify // a JSON string is a valid TOML basic string

export function codexHooks(i: { pluginRoot: string | null; rtkBin: string | null; platform: NodeJS.Platform }): CodexInjection {
  const root = i.pluginRoot && !missingEconomizerFiles(i.pluginRoot).length ? i.pluginRoot : null
  const hooks: Hooks = root ? { ...pluginHooks(root) } : {}
  const economizer = Object.keys(hooks).length > 0
  if (i.rtkBin) {
    const rtk: Group = { matcher: 'Bash', hooks: [{ command: `"${i.rtkBin}" hook codex` }] }
    hooks.PreToolUse = [...(hooks.PreToolUse ?? []), rtk]
  }
  const args: string[] = []
  const trust: string[] = []
  for (const [event, groups] of Object.entries(hooks)) {
    const toml = groups.map((g, gi) => {
      const handlers = g.hooks.map((h, hi) => {
        const command = (i.platform === 'win32' && h.commandWindows) || h.command
        const timeout = timeoutOf(event, h.timeout)
        const hash = trustHash(event, g.matcher, command, timeout)
        for (const file of flagSources(i.platform)) trust.push(`${str(`${file}:${label(event)}:${gi}:${hi}`)} = { trusted_hash = ${str(hash)} }`)
        return `{ type = "command", command = ${str(command)}, timeout = ${timeout} }`
      })
      const matcher = g.matcher === undefined ? '' : `matcher = ${str(g.matcher)}, `
      return `{ ${matcher}hooks = [${handlers.join(', ')}] }`
    })
    args.push('-c', `hooks.${event}=[${toml.join(', ')}]`)
  }
  // the whole table in one value: -c splits dotted keys, and these keys have dots
  if (trust.length) args.push('-c', `hooks.state={ ${trust.join(', ')} }`)
  return { args, env: root && economizer ? { PLUGIN_ROOT: root } : {} }
}
