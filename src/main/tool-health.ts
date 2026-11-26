// Real per-agent health of the token-saving tools. Read-only: it never touches the user's
// Codex files, approving a hook stays with the user (/hooks inside Codex).
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentCoverage } from '../shared/plugin-health.ts'

export type CodexHook = 'approved' | 'unapproved' | 'missing'
/** `injected`: BrandyTerm passes the hook on each run, whatever ~/.codex has */
export type CodexRtk = CodexHook | 'injected'

function read(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/** Positions `<group>:<hook>` of the PreToolUse hooks that run RTK in Codex's hooks.json. */
function rtkPositions(json: string): string[] {
  try {
    const groups: unknown = JSON.parse(json)?.hooks?.PreToolUse
    if (!Array.isArray(groups)) return []
    return groups.flatMap((g, i) =>
      (Array.isArray(g?.hooks) ? g.hooks : []).flatMap((h: { command?: unknown }, j: number) =>
        /\brtk(\.exe)?"? hook codex\b/.test(String(h?.command ?? '')) ? [`${i}:${j}`] : []))
  } catch {
    return []
  }
}

/** Codex only runs a hook it has a trust record for, in `[hooks.state."<file>:pre_tool_use:G:H"]`. */
function trusted(toml: string, key: string): boolean {
  // TOML basic strings double the backslashes of a Windows path
  const header = [`[hooks.state."${key.replaceAll('\\', '\\\\')}"]`, `[hooks.state.'${key}']`]
  const lines = toml.split('\n').map((l) => l.trim())
  const start = lines.findIndex((l) => header.includes(l))
  if (start < 0) return false
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.startsWith('['))
  const body = end < 0 ? rest : rest.slice(0, end)
  return body.some((l) => l.startsWith('trusted_hash')) && !body.some((l) => /^enabled\s*=\s*false/.test(l))
}

export function codexRtkHook(dir: string = process.env.CODEX_HOME || join(homedir(), '.codex')): CodexHook {
  const file = join(dir, 'hooks.json')
  const found = rtkPositions(read(file))
  if (!found.length) return 'missing'
  const toml = read(join(dir, 'config.toml'))
  return found.some((pos) => trusted(toml, `${file}:pre_tool_use:${pos}`)) ? 'approved' : 'unapproved'
}

const CODEX_RTK: Record<CodexRtk, string> = {
  injected: 'hook injetado pelo BrandyTerm em cada execução',
  approved: 'hook instalado e com registro de aprovação',
  unapproved: 'hook instalado, mas sem aprovação: abra o Codex e use /hooks',
  missing: 'sem hook do RTK: rode rtk init -g --codex'
}

export function rtkCoverage(installed: boolean, codex: CodexRtk | null): AgentCoverage[] {
  const claude: AgentCoverage = {
    agent: 'claude',
    ok: installed,
    detail: installed ? 'hook injetado nas threads, leituras e varreduras; o coordenador não tem shell' : 'RTK não instalado'
  }
  if (!codex) return [claude]
  return [claude, { agent: 'codex', ok: installed && (codex === 'approved' || codex === 'injected'), detail: installed ? CODEX_RTK[codex] : 'RTK não instalado' }]
}

/** `codex`: `null` when it is not installed; `problem` is why its threads run without the plugin */
export function economizerCoverage(missing: string[], codex: { problem: string | null } | null): AgentCoverage[] {
  const ok = !missing.length
  const claude: AgentCoverage = {
    agent: 'claude',
    ok,
    detail: ok
      ? 'carregado nas threads; a poda de ferramentas só propõe; o coordenador não o carrega'
      : `não funciona, falta ${missing.join(', ')}: rode npm run plugins`
  }
  if (!codex) return [claude]
  return [claude, { agent: 'codex', ok: !codex.problem, detail: codex.problem ?? 'hooks injetados pelo BrandyTerm em cada thread' }]
}
