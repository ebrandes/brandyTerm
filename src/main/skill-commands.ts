// /skill-init, /skill-refresh and /skill-install: update the library, then start a Claude thread that
// may use the skills_* gateway tools (each change goes through a card). Paths and the library setting
// come from a provider set at startup, so this file never imports electron.
import { randomUUID } from 'node:crypto'
import type { Attachment, Project, Thread } from '../shared/types.ts'
import type { Engine } from './engine.ts'
import { forPlatform, readCatalog } from './skills/catalog.ts'
import { libraryUrl, realGit, syncLibrary, type GitRun } from './skills/library.ts'
import type { SkillsPaths } from './skills/paths.ts'
import { readList } from './skills/project-list.ts'
import { skillPrompt, type SkillKind } from './skills/prompts.ts'
import { projectSignals } from './skills/signals.ts'

export interface SkillEnv {
  paths: SkillsPaths
  /** the skillsLibrary setting: `dono/repo` or an https URL; unset → the default library */
  library?: string
  git?: GitRun
}

let env: (() => SkillEnv) | null = null

export function setSkillEnv(fn: () => SkillEnv): void {
  env = fn
}

const KINDS: Record<string, SkillKind> = { 'skill-init': 'init', 'skill-refresh': 'refresh', 'skill-install': 'install' }

export const skillKind = (name: string): SkillKind | null => KINDS[name] ?? null

/** Updates the library; returns the notes for the user (empty when all went well). */
function refreshLibrary(s: SkillEnv): string[] {
  let url: string
  try {
    url = libraryUrl(s.library)
  } catch {
    return ['Biblioteca inválida nas configurações (use dono/repo ou uma URL https): usando a cópia que já existe.']
  }
  const r = syncLibrary(url, s.paths.lib, s.git ?? realGit)
  return r.aviso ? [r.aviso] : []
}

export function runSkillCommand(e: Engine, p: Project, cmd: { name: string; args: string }, atts: Attachment[], t?: Thread): void {
  const kind = skillKind(cmd.name)
  if (!kind) return
  const raw = `/${cmd.name}${cmd.args ? ' ' + cmd.args : ''}`
  const log = t ? t.messages : p.messages
  log.push(e.msg('user', raw, t ? {} : { attachments: atts }))
  const note = (text: string, isError = true) => {
    log.push(e.msg('system', text, { isError }))
    e.touch()
  }
  if (t) return note('Os comandos /skill-* rodam no chat do projeto, fora das threads.')
  if (!p.path) return note('Esse comando precisa de um projeto com pasta.')
  if (!e.installed().has('claude')) return note('Comandos com / precisam do Claude Code instalado.')
  const words = cmd.args.split(/\s+/).filter(Boolean)
  const buscar = words.includes('--buscar')
  const args = words.filter((w) => w !== '--buscar').join(' ')
  if (kind === 'install' && !args) return note('Use /skill-install <origem>: dono/repo, uma URL do GitHub ou um id do catálogo.')
  const s = env?.()
  if (!s) return note('Biblioteca de skills indisponível.')
  for (const aviso of refreshLibrary(s)) note(aviso, false)
  const cat = readCatalog(s.paths.lib)
  if (cat.erro) return note(`${cat.erro}: corrija a biblioteca antes de mudar a lista.`)
  const cur = readList(p.path)
  if (cur.erro) return note(`${cur.erro}: corrija o arquivo antes de mudar a lista.`)
  const itens = cat.itens.filter((i) => forPlatform(i, process.platform))
  const prompt = skillPrompt(kind, { args, itens, list: cur.list, signals: projectSignals(p.path), buscar })
  const nt = e.createThread(p, { title: `/${cmd.name}`, objective: raw, agent: 'claude', effort: 'medium', why: 'comando / do usuário' }, randomUUID(), atts)
  // set before the start: the gateway reads it to offer the skills_* tools
  nt.skillsTask = kind
  p.messages.push(e.msg('coordinator', `Rodando \`/${cmd.name}\` numa thread do Claude.`, { threads: [nt.id] }))
  e.startThread(p, nt, prompt, true, atts)
}
