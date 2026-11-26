// Connects the skills modules to the running app: paths under userData, the claude and gh CLIs, the
// security scanner, the approval cards and each project's panel. The only skills file importing electron.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { ThreadRef } from '../../shared/connectors.ts'
import type { CatalogItem } from '../../shared/types.ts'
import { resolveCli } from '../adapters/proc.ts'
import type { GwHandler } from '../connectors/gateway-server.ts'
import type { Engine } from '../engine.ts'
import { discoverPlugins } from '../plugins.ts'
import { scanDir, scanPlugin, type ScanResult } from '../security.ts'
import { appSettings } from '../settings.ts'
import { setSkillEnv } from '../skill-commands.ts'
import { fallbackOn, installedMap, loadUserPlugins, userPluginsState } from '../user-plugins.ts'
import { readCatalog } from './catalog.ts'
import type { SkillsDeps } from './handler-ctx.ts'
import { createSkillsHandler } from './handler.ts'
import { installPlugin, type CliRun } from './install.ts'
import { libraryUrl, realGit, syncLibrary } from './library.ts'
import { libSkillsDir, skillsPaths, type SkillsPaths } from './paths.ts'
import { readList } from './project-list.ts'
import { projectView, type ToggleDeps } from './view.ts'

export const paths = (): SkillsPaths => skillsPaths(app.getPath('userData'))

/** A CLI from PATH; when it is missing or can't start, code 1 with the reason. */
function cli(name: string, timeout?: number): CliRun {
  return (args) =>
    new Promise((resolve) => {
      const c = resolveCli(name)
      if (!c) return resolve({ code: 1, out: `${name} não encontrado no PATH` })
      const child = spawn(c.cmd, [...c.prefix, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout })
      let out = ''
      child.stdout.on('data', (d) => (out += d))
      child.stderr.on('data', (d) => (out += d))
      child.on('error', (err) => resolve({ code: 1, out: err.message }))
      child.on('close', (code) => resolve({ code: code ?? 1, out: out.trim() }))
    })
}
const claude = cli('claude')
const gh = cli('gh', 15_000)

function knownMarkets(): Set<string> {
  try {
    const raw = JSON.parse(readFileSync(join(homedir(), '.claude', 'plugins', 'known_marketplaces.json'), 'utf8'))
    return new Set(raw && typeof raw === 'object' ? Object.keys(raw) : [])
  } catch {
    return new Set()
  }
}

const NO_SCANNER: ScanResult = { ok: false, counts: {}, blocked: true, error: 'Claude Security ausente; rode npm run plugins antes de instalar' }
const scanner = () => discoverPlugins().find((p) => p.scanner)?.dir

async function repoMeta(owner: string, repo: string): Promise<{ estrelas: number | null; licenca: string | null }> {
  const r = await gh(['api', `repos/${owner}/${repo}`])
  try {
    const j = r.code === 0 ? JSON.parse(r.out) : null
    return {
      estrelas: typeof j?.stargazers_count === 'number' ? j.stargazers_count : null,
      licenca: typeof j?.license?.spdx_id === 'string' ? j.license.spdx_id : null,
    }
  } catch {
    return { estrelas: null, licenca: null }
  }
}

function libSkills(p: SkillsPaths): Set<string> {
  const dir = libSkillsDir(p)
  try {
    return new Set(readdirSync(dir).filter((n) => existsSync(join(dir, n, 'SKILL.md'))))
  } catch {
    return new Set()
  }
}

export const catalogItems = (): CatalogItem[] => readCatalog(paths().lib).itens

/** Recomputes the panels (of one project, or all) from the disk. */
export function refreshSkills(e: Engine, only?: string): void {
  const p = paths()
  const cat = readCatalog(p.lib)
  const aviso = cat.erro
    ? `${cat.erro}: o painel mostra só o que está instalado.`
    : existsSync(join(p.lib, '.git'))
      ? undefined
      : 'Biblioteca ainda não baixada: rode /skill-init para baixar.'
  const lib = libSkills(p)
  const installed = userPluginsState().list
  const views = { ...e.state.projectSkills }
  for (const proj of e.state.projects) {
    if (!proj.path || (only && proj.id !== only)) continue
    const r = readList(proj.path)
    views[proj.id] = projectView({ list: r.list, erro: r.erro, itens: cat.itens, installed, libSkills: lib, fallbackOn: fallbackOn(proj.path), platform: process.platform, aviso })
  }
  for (const id of Object.keys(views)) if (!e.state.projects.some((x) => x.id === id && x.path)) delete views[id]
  e.state.projectSkills = views
}

/** `--scope user`; a plugin outside the catalog is scanned first. On success the panels re-read. */
async function install(e: Engine, id: string, item?: CatalogItem): Promise<{ ok: boolean; erro?: string }> {
  const dir = scanner()
  const scan = (spec: string) => (dir ? scanPlugin(spec, dir) : Promise.resolve(NO_SCANNER))
  const r = await installPlugin(id, { item, knownMarkets: knownMarkets(), run: claude, scan })
  if (r.ok) {
    loadUserPlugins()
    e.state.userPlugins = userPluginsState()
    refreshSkills(e)
    e.touch()
  }
  return r
}

export const toggleDeps = (e: Engine, projectPath: string): ToggleDeps => ({
  itens: catalogItems(),
  installed: installedMap(),
  fallbackOn: fallbackOn(projectPath),
  install: (id, item) => install(e, id, item),
})

/** The library update the panel's "Instalar" runs for missing skills. */
export function syncNow(): { ok: boolean; aviso?: string } {
  try {
    return syncLibrary(libraryUrl(appSettings().skillsLibrary), paths().lib)
  } catch {
    return { ok: false, aviso: 'Biblioteca inválida nas configurações: use dono/repo ou uma URL https.' }
  }
}

function findThread(e: Engine, ref: ThreadRef) {
  const p = e.state.projects.find((x) => x.id === ref.projectId)
  const t = p?.threads.find((x) => x.id === ref.threadId)
  return p && t ? { p, t } : undefined
}

/** Fills the panels and returns what the connectors gateway needs for the skills_* tools. */
export function startSkills(e: Engine): { skills: GwHandler; isSkillsThread: (t: ThreadRef) => boolean } {
  const changed = (projectId?: string) => {
    refreshSkills(e, projectId)
    e.touch()
  }
  setSkillEnv(() => ({ paths: paths(), library: appSettings().skillsLibrary, onSync: () => changed() }))
  const deps: SkillsDeps = {
    paths: paths(),
    findThread: (ref) => findThread(e, ref),
    ask: (t, a) => e.approvals.ask(t, a),
    install: (id, item) => install(e, id, item),
    scanDir: (dir) => {
      const s = scanner()
      return s ? scanDir(dir, s) : Promise.resolve(NO_SCANNER)
    },
    installed: installedMap,
    repoMeta,
    git: realGit,
    changed,
  }
  refreshSkills(e)
  // a project opened later gets its panel on the next change
  e.on('change', () => {
    if (e.state.projects.some((p) => p.path && !e.state.projectSkills?.[p.id])) changed()
  })
  return { skills: createSkillsHandler(deps), isSkillsThread: (ref) => !!findThread(e, ref)?.t.skillsTask }
}
