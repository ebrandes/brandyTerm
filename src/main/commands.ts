import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { SlashCommand } from '../shared/types.ts'
import { diagLogOnChange } from './diag-log.ts'

/**
 * Slash commands of the composer. `/clear`, `/compact`, `/help` and the `/skill-*` commands are
 * handled by the app; every other command (plugin skills, plugin and project commands) runs in a
 * Claude thread, which expands it in headless mode like the interactive CLI does.
 */

export const APP_COMMANDS: SlashCommand[] = [
  { name: 'clear', description: 'Começa uma conversa nova com o coordenador (ou com esta thread). O histórico na tela fica.', source: 'app' },
  { name: 'compact', description: 'Resume o contexto da sessão para economizar tokens, mantendo o essencial.', source: 'app' },
  { name: 'help', description: 'Lista os comandos disponíveis.', source: 'app' },
  { name: 'skill-init', description: 'Propõe as skills e plugins deste projeto a partir da biblioteca, com um cartão por item. Com --buscar, procura também fora dela.', source: 'app' },
  { name: 'skill-refresh', description: 'Revê a lista de skills do projeto: o que ligar e o que tirar, com um cartão por item. Aceita --buscar.', source: 'app' },
  { name: 'skill-install', description: 'Instala e liga neste projeto uma skill ou plugin (dono/repo, URL do GitHub ou id do catálogo), depois da checagem de segurança.', source: 'app' }
]

export function parseSlash(text: string): { name: string; args: string } | null {
  const m = /^\/([\w][\w:.-]*)(?:\s+([\s\S]*))?$/.exec(text.trim())
  return m ? { name: m[1], args: (m[2] ?? '').trim() } : null
}

function frontmatter(file: string): Record<string, string> {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return {}
  }
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const out: Record<string, string> = {}
  for (const line of m?.[1].split(/\r?\n/) ?? []) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line)
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim()
  }
  return out
}

function entries(dir: string, dirs: boolean): string[] {
  try {
    // stat follows symlinks: personal skills are often links to another folder
    return readdirSync(dir).filter((n) => {
      try {
        const st = statSync(join(dir, n))
        return dirs ? st.isDirectory() : st.isFile() && n.endsWith('.md')
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

const short = (d: string | undefined) => {
  const v = (d ?? '').replace(/\s+/g, ' ').trim()
  return v.length > 160 ? v.slice(0, 157) + '…' : v
}

/** skills/<name>/SKILL.md and <commands dir>/*.md, prefixed with `prefix:` for plugins */
function scan(root: string, commandsDirs: string[], prefix: string, source: SlashCommand['source']): SlashCommand[] {
  const out: SlashCommand[] = []
  const name = (n: string) => (prefix ? `${prefix}:${n}` : n)
  for (const s of entries(join(root, 'skills'), true)) {
    const fm = frontmatter(join(root, 'skills', s, 'SKILL.md'))
    if (fm.name || existsSync(join(root, 'skills', s, 'SKILL.md'))) out.push({ name: name(fm.name || s), description: short(fm.description), source, skill: true })
    else {
      const dir = join(root, 'skills', s)
      diagLogOnChange(`skill:${dir}`, 'skills', 'warn', 'pasta de skill sem SKILL.md legível', { dir })
    }
  }
  for (const dir of commandsDirs) {
    for (const f of entries(join(root, dir), false)) {
      out.push({ name: name(basename(f, '.md')), description: short(frontmatter(join(root, dir, f)).description), source })
    }
  }
  return out
}

function pluginCommands(dir: string): SlashCommand[] {
  let manifest: { name?: string; commands?: string | string[] } = {}
  try {
    manifest = JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))
  } catch (error) {
    // no manifest: use the folder name
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      diagLogOnChange(`manifest:${dir}`, 'skills', 'warn', 'plugin.json ilegível', { dir, error: String(error) })
    }
  }
  const cmds = manifest.commands ? [manifest.commands].flat() : ['commands']
  return scan(dir, cmds.map((c) => c.replace(/^\.\//, '').replace(/\/$/, '')), manifest.name || basename(dir), 'plugin')
}

/** Every command the composer can offer for a project. */
export function discoverCommands(pluginDirs: string[], projectPath: string | null): SlashCommand[] {
  const all = [...APP_COMMANDS, ...pluginDirs.flatMap(pluginCommands)]
  if (projectPath) all.push(...scan(join(projectPath, '.claude'), ['commands'], '', 'project'))
  const seen = new Set<string>()
  const unique = all.filter((c) => !seen.has(c.name) && seen.add(c.name))
  const names = unique.filter((c) => c.skill).map((c) => c.name)
  diagLogOnChange(`discovery:${projectPath ?? ''}`, 'skills', 'info', 'skills descobertas', { project: projectPath, pluginDirs, count: names.length, names })
  return unique
}

export function helpText(cmds: SlashCommand[]): string {
  const line = (c: SlashCommand) => `- \`/${c.name}\`${c.description ? ` — ${c.description}` : ''}`
  const app = cmds.filter((c) => c.source === 'app')
  const rest = cmds.filter((c) => c.source !== 'app')
  return [
    '**Comandos do BrandyTerm**',
    ...app.map(line),
    '',
    '**Skills e comandos dos plugins e do projeto** (rodam numa thread do Claude)',
    ...(rest.length ? rest.map(line) : ['- nenhum encontrado'])
  ].join('\n')
}
