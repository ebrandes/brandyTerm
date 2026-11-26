import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { app } from 'electron'
import type { UserPlugin, UserPluginsState } from '../shared/types.ts'
import { diagLog, diagLogOnChange } from './diag-log.ts'
import { OWN_PLUGIN_NAMES } from './plugins.ts'
import { countSkills } from './skills/count.ts'
import { skillsPaths } from './skills/paths.ts'
import { projectDirs } from './skills/project-dirs.ts'

/**
 * The user's own Claude Code skills and plugins, offered to BrandyTerm threads.
 * Threads run with `--setting-sources project`, so nothing from ~/.claude loads by
 * itself; what the user turns on here is passed with `--plugin-dir`. Personal skills
 * (~/.claude/skills) are wrapped in a generated plugin named "pessoal". MCP servers
 * inside plugins stay off because threads run with --strict-mcp-config.
 */

const CLAUDE_HOME = join(homedir(), '.claude')

interface Found extends Omit<UserPlugin, 'on'> {
  dir: string
  projectPath?: string
}

interface Prefs {
  personal: boolean
  on: string[]
}

let found: Found[] = []
let prefs: Prefs = { personal: true, on: [] }

const prefsFile = () => join(app.getPath('userData'), 'thread-plugins.json')

function readJson(p: string): any {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      diagLogOnChange(`json:${p}`, 'plugins', 'warn', 'JSON ilegível', { file: p, error: String(error) })
    }
    return null
  }
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

const skillCount = (dir: string) => list(dir).filter((d) => existsSync(join(dir, d, 'SKILL.md'))).length
const mdCount = (dir: string) => list(dir).filter((f) => f.endsWith('.md')).length

function inspect(dir: string): Pick<Found, 'skills' | 'commands' | 'agents' | 'hooks' | 'mcp' | 'description'> {
  const m = readJson(join(dir, '.claude-plugin', 'plugin.json')) ?? {}
  return {
    skills: countSkills(dir),
    commands: mdCount(join(dir, 'commands')),
    agents: mdCount(join(dir, 'agents')),
    hooks: !!m.hooks || existsSync(join(dir, 'hooks', 'hooks.json')),
    mcp: !!m.mcpServers || existsSync(join(dir, '.mcp.json')),
    description: typeof m.description === 'string' ? m.description.slice(0, 200) : undefined
  }
}

/** Reads ~/.claude/plugins/installed_plugins.json: one entry per plugin and scope. */
function scan(): Found[] {
  const data = readJson(join(CLAUDE_HOME, 'plugins', 'installed_plugins.json'))
  const out: Found[] = []
  for (const [key, entries] of Object.entries<any[]>(data?.plugins ?? {})) {
    const name = key.split('@')[0]
    if (OWN_PLUGIN_NAMES.has(name) || !Array.isArray(entries)) continue
    for (const e of entries) {
      const dir = String(e?.installPath ?? '')
      if (!dir || !existsSync(join(dir, '.claude-plugin', 'plugin.json'))) {
        diagLogOnChange(`user:${key}:${dir}`, 'plugins', 'warn', 'plugin do usuário ignorado: sem .claude-plugin/plugin.json', { plugin: key, dir })
        continue
      }
      const projectPath = e.scope === 'user' ? undefined : String(e.projectPath ?? '')
      if (projectPath === '') continue
      out.push({
        id: projectPath ? `${key}#${projectPath}` : key,
        name,
        version: e.version ? String(e.version).slice(0, 12) : undefined,
        scope: projectPath ? 'project' : 'user',
        project: projectPath ? basename(projectPath) : undefined,
        dir,
        projectPath,
        ...inspect(dir)
      })
    }
  }
  return out.sort((a, b) => Number(a.scope === 'project') - Number(b.scope === 'project') || a.name.localeCompare(b.name))
}

/** Generated plugin whose skills/commands are links to ~/.claude/skills and ~/.claude/commands. */
function personalDir(): string | null {
  const dir = join(app.getPath('userData'), 'personal-skills')
  const parts = ['skills', 'commands'].filter((p) => existsSync(join(CLAUDE_HOME, p)))
  if (!parts.length) return null
  try {
    mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
    const manifest = join(dir, '.claude-plugin', 'plugin.json')
    if (!existsSync(manifest)) writeFileSync(manifest, JSON.stringify({ name: 'pessoal', version: '1.0.0', description: 'Skills e comandos de ~/.claude' }))
    for (const p of parts) {
      const link = join(dir, p)
      if (existsSync(link)) continue
      // a dangling link fails existsSync but still occupies the path
      try {
        if (lstatSync(link)) rmSync(link, { force: true })
      } catch {
        // nothing there
      }
      symlinkSync(join(CLAUDE_HOME, p), link, process.platform === 'win32' ? 'junction' : 'dir')
    }
    return dir
  } catch (error) {
    diagLogOnChange('skills:personal', 'skills', 'error', 'falha ao montar as skills pessoais', { dir, error: String(error) })
    return null
  }
}

export function loadUserPlugins(): void {
  const saved = readJson(prefsFile())
  if (saved) prefs = { personal: saved.personal !== false, on: Array.isArray(saved.on) ? saved.on.map(String) : [] }
  found = scan()
  diagLog('plugins', 'info', 'plugins do usuário lidos', {
    found: found.map((f) => f.id), on: prefs.on, personal: prefs.personal
  })
}

export function userPluginsState(): UserPluginsState {
  const personal = existsSync(join(CLAUDE_HOME, 'skills')) || existsSync(join(CLAUDE_HOME, 'commands'))
  return {
    personal: personal
      ? { skills: skillCount(join(CLAUDE_HOME, 'skills')), commands: mdCount(join(CLAUDE_HOME, 'commands')), on: prefs.personal }
      : undefined,
    list: found.map(({ dir: _d, projectPath: _p, ...f }) => ({ ...f, on: prefs.on.includes(f.id) }))
  }
}

/** Turns a plugin (or "personal") on or off for threads; also re-reads what is installed. */
export function setUserPlugin(id: string, on: boolean): void {
  if (id === 'personal') prefs.personal = on
  else prefs.on = on ? [...new Set([...prefs.on, id])] : prefs.on.filter((x) => x !== id)
  try {
    writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2))
  } catch (error) {
    diagLog('plugins', 'error', 'falha ao salvar a escolha de plugins', { id, on, error })
    throw error
  }
  diagLog('plugins', 'info', on ? 'plugin ligado nas threads' : 'plugin desligado nas threads', { id })
  found = scan()
}

/** Installed plugins by plain id (no `#project`), preferring the user-scope install. */
export function installedMap(): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of found) {
    const id = f.id.split('#')[0]
    if (f.scope === 'user' || !out.has(id)) out.set(id, f.dir)
  }
  return out
}

/**
 * Plugin dirs for a thread in `projectPath`. A project with `.brandyterm/skills.json` gets
 * what its list resolves to; one without a list (or with a broken one) keeps the old
 * behaviour: the plugins turned on in thread-plugins.json plus "pessoal".
 */
export function userPluginDirs(projectPath: string | null): string[] {
  if (projectPath) {
    try {
      const own = projectDirs(projectPath, skillsPaths(app.getPath('userData')), installedMap(), process.platform)
      if (own) return own
    } catch (error) {
      diagLogOnChange(`skills:project:${projectPath}`, 'skills', 'error', 'falha ao montar as skills do projeto', { projectPath, error: String(error) })
    }
  }
  const dirs = found.filter((f) => prefs.on.includes(f.id) && (!f.projectPath || f.projectPath === projectPath)).map((f) => f.dir)
  const own = prefs.personal ? personalDir() : null
  return own ? [own, ...dirs] : dirs
}
