import type { ApprovalAsk } from './adapters/types.ts'
import { READ_ONLY } from './rtk.ts'

/**
 * What "always" remembers. A Bash command is split into its parts (`a && b | c`), each
 * reduced to its head: the program, plus the subcommand for tools that have them
 * (`npm test`, `git commit`, `pnpm run`). `cd` and env assignments are ignored. A later
 * command is covered when every part's head was allowed. Edits share one family.
 */

const SUBCOMMANDS = new Set(['npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx', 'git', 'cargo', 'go', 'docker', 'kubectl', 'gh', 'make', 'uv', 'pip', 'poetry', 'dotnet', 'mvn', 'gradle', 'deno', 'brew'])
/** prefixes that only wrap the real command */
const WRAPPERS = new Set(['rtk', 'time', 'env', 'nohup'])
const EDITS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
/** subcommands that run anything: the script name is part of the head (`npm run build`) */
const RUNNERS = new Set(['run', 'exec', 'x', 'dlx'])
/** read-only parts (`| tail`, `&& ls`) never need a rule of their own */
const FREE = new Set([...READ_ONLY, 'read', 'cd', 'pwd', 'echo', 'true', 'sort', 'uniq', 'jq', 'cut', 'tr'])

/** command substitution hides a second command inside an argument: never covered by a rule */
const HIDDEN = /\$\(|`|<\(|>\(/

/** Splits on && || & ; | and newlines outside quotes. */
function parts(command: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote = ''
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      // an escaped char inside double quotes never closes them
      if (c === '\\' && quote === '"') {
        cur += c + (command[++i] ?? '')
        continue
      }
      if (c === quote) quote = ''
      cur += c
      continue
    }
    if (c === '"' || c === "'") quote = c
    // a lone & runs the left side in the background and starts another command; 2>&1 and &> are redirects
    const amp = c === '&' && command[i - 1] !== '>' && command[i + 1] !== '>'
    if (c === ';' || c === '|' || c === '\n' || amp) {
      out.push(cur)
      cur = ''
      if (command[i + 1] === c) i++
      continue
    }
    cur += c
  }
  return [...out, cur]
}

function head(part: string): string | undefined {
  const words = part.trim().split(/\s+/).filter(Boolean)
  while (words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) || WRAPPERS.has(words[0]))) words.shift()
  const prog = words[0]?.replace(/^.*\//, '')
  if (!prog || prog === 'cd' || prog === 'pushd' || prog === 'popd') return undefined
  const word = (w?: string) => (w && /^[a-z][\w:.-]*$/i.test(w) ? w : undefined)
  const sub = SUBCOMMANDS.has(prog) ? word(words[1]) : undefined
  if (!sub) return prog
  const script = RUNNERS.has(sub) ? word(words[2]) : undefined
  return [prog, sub, script].filter(Boolean).join(' ')
}

/** The heads of a shell command, one per part. */
export function commandHeads(command: string): string[] {
  return [...new Set(parts(command).map(head).filter((h): h is string => !!h))]
}

/** The rules an "always" answer adds for this call. */
export function rulesFor(a: Pick<ApprovalAsk, 'tool' | 'input'>): string[] {
  if (a.tool === 'Bash') return commandHeads(String(a.input.command ?? '')).filter((h) => !FREE.has(h)).map((h) => `Bash:${h}`)
  return [EDITS.has(a.tool) ? 'Edits' : a.tool]
}

/** True when the rules already allowed cover this call. */
export function covered(rules: readonly string[] | undefined, a: Pick<ApprovalAsk, 'tool' | 'input'>): boolean {
  if (!rules?.length) return false
  if (a.tool === 'Bash' && HIDDEN.test(String(a.input.command ?? ''))) return false
  const need = rulesFor(a).filter((r) => !FREE.has(r.replace(/^Bash:/, '')))
  return need.length > 0 && need.every((r) => rules.includes(r))
}

/** How the "always" button reads for this call. */
export function alwaysLabel(a: Pick<ApprovalAsk, 'tool' | 'input'>): string {
  if (a.tool !== 'Bash') return EDITS.has(a.tool) ? 'Sempre editar arquivos nesta thread' : `Sempre ${a.tool} nesta thread`
  const heads = commandHeads(String(a.input.command ?? '')).filter((h) => !FREE.has(h))
  return heads.length ? `Sempre ${heads.map((h) => `“${h}”`).join(', ')} nesta thread` : 'Sempre este comando nesta thread'
}
