// What every skills_* tool shares: its deps, the request it runs for, and the approval card.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ThreadRef } from '../../shared/connectors.ts'
import type { ApprovalDecision, CatalogItem, Project, SkillsList, Thread } from '../../shared/types.ts'
import type { ApprovalAsk } from '../adapters/types.ts'
import { CALL_CANCELLED } from '../connectors/gateway-protocol.ts'
import type { ScanResult } from '../security.ts'
import { readCatalog } from './catalog.ts'
import type { GitRun } from './library.ts'
import type { SkillsPaths } from './paths.ts'
import { readList, writeList } from './project-list.ts'

export interface SkillsDeps {
  paths: SkillsPaths
  findThread(ref: ThreadRef): { p: Project; t: Thread } | undefined
  ask(t: Thread, a: ApprovalAsk): Promise<ApprovalDecision>
  /** `--scope user`; `item` absent means the plugin is outside the catalog and gets scanned */
  install(id: string, item?: CatalogItem): Promise<{ ok: boolean; erro?: string }>
  /** claude-security over a local folder */
  scanDir(dir: string): Promise<ScanResult>
  /** installed plugins by plain id */
  installed(): Map<string, string>
  /** `gh api repos/o/r`: null fields when gh fails */
  repoMeta?(owner: string, repo: string): Promise<{ estrelas: number | null; licenca: string | null }>
  git?: GitRun
  /** the project's list changed: its panel refreshes */
  changed(projectId: string): void
}

export interface Ctx {
  d: SkillsDeps
  p: Project
  t: Thread
  /** the project folder */
  path: string
  args: Record<string, unknown>
  signal: AbortSignal
}

export const REFUSED = 'Recusado pelo usuário.'

/** "Sempre" on a skills card allows this call only: there is no global store for it */
const PROCEED = new Set<ApprovalDecision>(['allow', 'always', 'all', 'forever'])
const CLIP = 600
const clip = (s: string) => (s.length <= CLIP ? s : `${s.slice(0, CLIP)}…`)

/**
 * One approval card. The connector card shows `detail`, not `summary`, so the detail opens with it.
 * `cardTool` names what "Sempre nesta thread" covers: a replace card never rides on an import one.
 */
export async function confirm(c: Ctx, tool: string, summary: string, detail: string, cardTool = tool): Promise<boolean> {
  // an aborted signal never fires 'abort' again: asking now would leave a card nobody waits on
  if (c.signal.aborted) throw new Error(CALL_CANCELLED)
  const answer = await c.d.ask(c.t, {
    tool: `mcp__skills__${tool}`,
    input: c.args,
    summary,
    detail: `${summary}\n\n${clip(detail)}`,
    connector: { id: 'skills', name: 'Skills', tool: cardTool },
    signal: c.signal,
  })
  if (c.signal.aborted) throw new Error(CALL_CANCELLED)
  return PROCEED.has(answer)
}

export function str(c: Ctx, key: string): string {
  const v = c.args[key]
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Informe ${key}.`)
  return v.trim()
}

/** The catalog; a broken catalogo.json is an error, so nothing rewrites it. */
export function catalog(c: Ctx): CatalogItem[] {
  const r = readCatalog(c.d.paths.lib)
  if (r.erro) throw new Error(`${r.erro}: corrija a biblioteca antes de mudar a lista.`)
  return r.itens
}

/** The project's list, null when it has none; a broken skills.json is an error, so nothing overwrites it. */
export function list(c: Ctx): SkillsList | null {
  const r = readList(c.path)
  if (r.erro) throw new Error(`${r.erro}: corrija o arquivo antes de mudar a lista.`)
  return r.list
}

/** Writing into a folder that is not a clone would make the next `git clone` of the library fail. */
export function needLibrary(c: Ctx): void {
  if (!existsSync(join(c.d.paths.lib, '.git'))) {
    throw new Error('Biblioteca não está clonada: confira o repositório no painel de skills e tente de novo.')
  }
}

export function save(c: Ctx, l: SkillsList): void {
  writeList(c.path, l)
  c.d.changed(c.p.id)
}
