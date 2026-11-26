// Recognizes a command line pasted in the wrong shape into a custom connector. Pure; used by the form and by main.
// The common mistake: pasting `claude mcp add … <url>` (what installs a server in Claude Code), which is not an
// MCP server itself: run as one it never answers initialize and the connector times out.

export interface FixedConnector {
  transport: 'stdio' | 'http'
  url?: string
  command?: string
  args?: string[]
  /** values the pasted line carried; secrets, so the form puts them in the secret fields */
  headers: Record<string, string>
  env: Record<string, string>
}

export interface PastedFix {
  /** install: another tool's install command; split: arguments typed in the command field */
  kind: 'install' | 'split'
  /** the tool whose install command it was (claude, codex) */
  tool?: string
  /** server name given in the install command */
  name?: string
  fixed: FixedConnector
}

/** Splits a shell-like line on spaces, keeping "double" and 'single' quoted parts together. */
export function splitCommandLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote = ''
  let has = false
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = ''
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      has = true
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += ch
      has = true
    }
  }
  if (has || cur) out.push(cur)
  return out
}

const INSTALLERS = new Set(['claude', 'codex'])
/** options of `claude mcp add` / `codex mcp add` that take a value */
const VALUE_FLAGS = new Set(['-t', '--transport', '-s', '--scope', '-e', '--env', '-H', '--header', '--url', '--client-id', '--callback-port', '--bearer-token-env-var'])

const baseName = (cmd: string): string => (cmd.split(/[\\/]/).pop() ?? cmd).toLowerCase().replace(/\.(exe|cmd)$/, '')

function parseAdd(tool: string, rest: string[]): PastedFix | null {
  const headers: Record<string, string> = {}
  const env: Record<string, string> = {}
  const positional: string[] = []
  let transport = ''
  let url = ''
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--') { positional.push(...rest.slice(i + 1)); break }
    if (!VALUE_FLAGS.has(a)) {
      if (!a.startsWith('-') || positional.length >= 2) positional.push(a)
      continue
    }
    const v = rest[++i] ?? ''
    if (a === '-t' || a === '--transport') transport = v.toLowerCase()
    else if (a === '--url') url = v
    else if (a === '-e' || a === '--env') { const k = v.indexOf('='); if (k > 0) env[v.slice(0, k)] = v.slice(k + 1) }
    else if (a === '-H' || a === '--header') { const k = v.indexOf(':'); if (k > 0) headers[v.slice(0, k).trim()] = v.slice(k + 1).trim() }
  }
  const [name, target, ...targetArgs] = positional
  if (!name) return null
  if (!url && target && (/^https?:\/\//i.test(target) || transport === 'http' || transport === 'sse')) url = target
  if (url) return { kind: 'install', tool, name, fixed: { transport: 'http', url, headers, env } }
  if (!target) return null
  return { kind: 'install', tool, name, fixed: { transport: 'stdio', command: target, args: targetArgs, headers, env } }
}

/**
 * What a custom stdio connector should be when its command was pasted in the wrong shape, or null when it looks fine.
 * `args` are the form's lines (one argument each); a line with spaces is split only inside an install command.
 */
export function fixPastedCommand(command: string, args: string[]): PastedFix | null {
  const head = splitCommandLine(command.trim())
  if (!head.length) return null
  // a line is split, unless it is the value of an option ("-H", "X-Key: abc" on two lines stays one header)
  const tokens = [...head]
  for (const a of args) {
    if (VALUE_FLAGS.has(tokens[tokens.length - 1])) tokens.push(a)
    else tokens.push(...splitCommandLine(a))
  }
  const tool = baseName(tokens[0])
  if (INSTALLERS.has(tool) && tokens[1] === 'mcp' && tokens[2] === 'add') return parseAdd(tool, tokens.slice(3))
  // "npx -y pkg" typed in the command field; a path with spaces ("C:\Program Files\…") is left alone
  if (head.length > 1 && !args.length && !/[\\/]/.test(head[0])) {
    return { kind: 'split', fixed: { transport: 'stdio', command: head[0], args: head.slice(1), headers: {}, env: {} } }
  }
  return null
}

/** The pt-BR explanation shown when an install command was saved or typed as the server command. */
export function installHint(fix: PastedFix): string {
  const where = fix.fixed.transport === 'http' ? `URL (http) ${fix.fixed.url}` : `comando ${[fix.fixed.command, ...(fix.fixed.args ?? [])].join(' ')}`
  return `Isso é o comando que instala o servidor no ${fix.tool === 'codex' ? 'Codex' : 'Claude Code'} (${fix.tool} mcp add), não o servidor MCP: ` +
    `rodado como conector, ele nunca responde. Use ${where}.`
}
