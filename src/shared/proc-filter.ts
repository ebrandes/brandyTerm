/**
 * What PROCESSOS hides (pure): the app itself, the agents and their plumbing (MCP servers, hooks).
 * What is left is what the user or the project started.
 */
import type { ProcEntry } from './proc-attribution.ts'
import { baseName, commandWords, effectiveCommand, knownKind } from './proc-kind.ts'
import { lineage } from './proc-tree.ts'

const SHELLS = /^-?(sh|bash|zsh|fish|dash|cmd|powershell|pwsh)(\.exe)?$/i
const AGENT_PROGRAMS = /^(claude|codex)$/
const APP_PROGRAMS = /^(electron|electron-vite|brandyterm)$/
const HOOK_PROGRAMS = /^(rtk|tokeneconomizer|hook\.py)$/
/** matched against the whole command, with forward slashes */
const AGENT_TEXT = /@anthropic-ai\/claude|claude-agent-sdk|@openai\/codex|\/claude\/versions\//i
const APP_TEXT = /\/(Electron|BrandyTerm)\.app\/|\/(Electron|BrandyTerm|Claude) Helper\b|^"?(Electron|BrandyTerm) Helper\b|--type=(renderer|gpu-process|utility)\b|\belectron-vite\b(?![\\/])/i
const MCP_TEXT = /(^|\s)--mcp\b|@modelcontextprotocol\/|\bmcp-remote\b|\bcodegraph(\.js)?"?\s+serve\b/i
const HOOK_TEXT = /\/tokeneconomizer\/\S*\.py\b|(^|[\s/])hook\.py\b/i

/** "x-mcp", "mcp-server-x", "@scope/mcp"; a folder that merely has "mcp" in its name is not asked */
const isMcpName = (name: string): boolean => /(^|[-_/])mcp$|(^|\/)mcp[-_]server|[-_]mcp@|[-_]mcp[-_]server|\/mcp@/i.test(name)

/** the program, the packages run from node_modules and, for runners, the package asked for */
function names(command: string): string[] {
  const { program, args } = effectiveCommand(command)
  // Windows starts npx through "cmd /c"
  if (program === 'cmd' && args[0]?.toLowerCase() === '/c') return names(args.slice(1).join(' '))
  const packages = commandWords(command).flatMap((w) => {
    const m = /.*node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(w.replace(/\\/g, '/'))
    return m && m[1] !== '.bin' ? [m[1]] : []
  })
  const first = args[0] && !/^[-.]|^\/|\\|^[A-Za-z]:/.test(args[0]) && /^(uv|uvx|pipx|docker)$/.test(program) ? [args[0]] : []
  return [program, ...packages, ...first]
}

function isAgent(command: string): boolean {
  return AGENT_PROGRAMS.test(effectiveCommand(command).program) || AGENT_TEXT.test(command.replace(/\\/g, '/'))
}

/** the command alone says it is an agent, the app, an MCP server or a hook */
function isInfraCommand(command: string): boolean {
  const text = command.replace(/\\/g, '/')
  const { program } = effectiveCommand(command)
  return (
    isAgent(command) || APP_PROGRAMS.test(program) || HOOK_PROGRAMS.test(program) ||
    APP_TEXT.test(text) || MCP_TEXT.test(text) || HOOK_TEXT.test(text) || names(command).some(isMcpName)
  )
}

const isShell = (command: string): boolean => SHELLS.test(baseName(commandWords(command)[0] ?? ''))

/** `shells`: pids known to be shells whatever their name (the integrated terminals') */
export function isInfra(entry: ProcEntry, byPid: Map<number, ProcEntry>, appPid: number, shells: Set<number>): boolean {
  if (lineage(byPid, appPid).includes(entry.pid)) return true
  if (isInfraCommand(entry.command)) return true
  // started by an agent or by the app with no shell in between: its own plumbing
  if (isShell(entry.command)) return false
  for (const pid of lineage(byPid, entry.pid).slice(1)) {
    if (shells.has(pid)) return false
    if (pid === appPid) return true
    const parent = byPid.get(pid)
    if (!parent) continue
    if (isShell(parent.command)) return false
    // some agents exec a command without a shell: a known dev tool is still the project's
    if (isAgent(parent.command)) return knownKind(entry.command) === undefined
    if (isInfraCommand(parent.command)) return true
  }
  return false
}
