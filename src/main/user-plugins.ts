import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { app } from 'electron'
import type { UserPlugin, UserPluginsState } from '../shared/types.ts'
import { OWN_PLUGIN_NAMES } from './plugins.ts'

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
  } catch {
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
    skills: skillCount(join(dir, 'skills')),
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
      if (!dir || !existsSync(join(dir, '.claude-plugin', 'plugin.json'))) continue
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
  } catch {
    return null
  }
}

export function loadUserPlugins(): void {
  const saved = readJson(prefsFile())
  if (saved) prefs = { personal: saved.personal !== false, on: Array.isArray(saved.on) ? saved.on.map(String) : [] }
  found = scan()
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
  writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2))
  found = scan()
}

/** Plugin dirs the user turned on, for a thread in `projectPath`. */
export function userPluginDirs(projectPath: string | null): string[] {
  const dirs = found.filter((f) => prefs.on.includes(f.id) && (!f.projectPath || f.projectPath === projectPath)).map((f) => f.dir)
  const own = prefs.personal ? personalDir() : null
  return own ? [own, ...dirs] : dirs
}
