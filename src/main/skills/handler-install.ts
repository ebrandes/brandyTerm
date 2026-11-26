// skills_resolve and skills_import: what /skill-install downloads for analysis and then brings into
// the library, after the security scan and one card per item.
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { CatalogItem } from '../../shared/types.ts'
import { inside } from '../paths.ts'
import { describeCounts } from '../security.ts'
import { itemFor, upsertCatalog } from './catalog.ts'
import { REFUSED, catalog, confirm, list, needLibrary, save, str, type Ctx } from './handler-ctx.ts'
import { copySkill, validSkillName } from './import.ts'
import { commitLibrary } from './library.ts'
import { parseOrigin, type GithubOrigin } from './origin.ts'
import { libSkillsDir } from './paths.ts'
import { emptyList, turnOn } from './project-list.ts'
import { stageOrigin } from './stage.ts'

/** What skills_resolve downloaded, by the folder it returned; only these may be imported. */
interface Staged {
  projectId: string
  /** the clone right under the staging root, deleted when the import ends */
  clone: string
  repo: string
  commit: string
  estrelas: number | null
  licenca: string | null
  kind: 'marketplace' | 'skills'
  plugins: string[]
  skills: string[]
}

interface Pedido { nome: string; descricao: string; tags: string[] }

const BAD_STAGING = 'Pasta de análise inválida: use a pasta que skills_resolve devolveu.'
const CORPORATE = 'Origem corporativa: itens corporativos não são baixados nem escaneados. Use skills_add com o id do catálogo.'

export const stagingRoot = (projectPath: string) => join(projectPath, '.brandyterm', 'tmp', 'skill-install')

/** A corporate store, by its `loja` or by a repo named like its market: never cloned or scanned. */
function corporate(itens: CatalogItem[], o: GithubOrigin): boolean {
  const slug = `${o.owner}/${o.repo}`.toLowerCase()
  const repo = o.repo.toLowerCase()
  return itens.some((i) => i.corporativo && (i.loja?.toLowerCase() === slug || i.id.split('@')[1]?.toLowerCase() === repo))
}

const real = (p: string): string | null => {
  try { return realpathSync(p) } catch { return null }
}

function pedidos(v: unknown): Pedido[] {
  if (!Array.isArray(v) || !v.length) throw new Error('Informe itens: [{nome, descricao, tags}].')
  return v.map((x) => {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    if (typeof r.nome !== 'string' || !validSkillName(r.nome)) throw new Error(`Nome inválido em itens: ${String(r.nome)}`)
    if (typeof r.descricao !== 'string' || !r.descricao.trim()) throw new Error(`Informe a descrição em pt-BR de ${r.nome}.`)
    const tags = Array.isArray(r.tags) ? r.tags.filter((s): s is string => typeof s === 'string' && !!s) : []
    return { nome: r.nome, descricao: r.descricao.trim(), tags }
  })
}

const source = (e: Staged) =>
  [`Repositório: ${e.repo} @ ${e.commit.slice(0, 7)}`, e.estrelas !== null ? `${e.estrelas} estrelas` : null, e.licenca ? `licença ${e.licenca}` : 'sem licença declarada']
    .filter(Boolean)
    .join(' · ')

/** The marketplace plugin to install. Its code must sit inside the folder that was scanned. */
function pluginPlan(c: Ctx, e: Staged, staging: string, ps: Pedido[], itens: CatalogItem[]): CatalogItem {
  if (staging !== e.clone) throw new Error('Loja em subpasta não é suportada: use o repositório da loja inteiro.')
  const plugin = str(c, 'plugin')
  if (!e.plugins.includes(plugin)) throw new Error(`${plugin} não está na loja ${e.repo}.`)
  if (!validSkillName(plugin)) throw new Error(`Nome de plugin inválido: ${plugin}`)
  const manifest = JSON.parse(readFileSync(join(staging, '.claude-plugin', 'marketplace.json'), 'utf8'))
  const market: unknown = manifest?.name
  if (typeof market !== 'string' || !validSkillName(market)) throw new Error('A loja não tem um nome válido no marketplace.json.')
  const src: unknown = (manifest.plugins as { name?: unknown; source?: unknown }[]).find((p) => p?.name === plugin)?.source
  const from = typeof src === 'string' ? real(resolve(staging, src)) : null
  const root = real(staging)
  if (!from || !root || (from !== root && !inside(root, from))) {
    throw new Error(`O código de ${plugin} vem de outro repositório (fora da pasta analisada): rode /skill-install com o repositório dele.`)
  }
  const pedido = ps.find((p) => p.nome === plugin)
  if (!pedido) throw new Error(`Informe em itens a descrição de ${plugin}.`)
  const id = `${plugin}@${market}`
  if (itemFor(itens, id)?.corporativo) throw new Error(CORPORATE)
  return { id, tipo: 'plugin', descricao: pedido.descricao, tags: pedido.tags, loja: e.repo }
}

/** Turns the imported items on, commits the library and says what happened. */
function finish(c: Ctx, e: Staged, feitos: CatalogItem[], linhas: string[], paths: string[]): string {
  if (!feitos.length) return linhas.join('\n') || REFUSED
  let l = list(c) ?? emptyList()
  for (const it of feitos) l = turnOn(l, it)
  save(c, l)
  const ids = feitos.map((f) => f.id).join(', ')
  const committed = commitLibrary(c.d.paths.lib, `biblioteca: ${ids} de ${e.repo}`, [join('biblioteca', 'catalogo.json'), ...paths], c.d.git)
  return [
    `Importado e ligado neste projeto: ${ids}. Vale a partir da próxima thread.`,
    ...linhas,
    committed ? 'Commit feito no clone da biblioteca. Ofereça skills_push para enviar.' : 'Nada novo para o commit da biblioteca.',
  ].join('\n')
}

async function importSkills(c: Ctx, e: Staged, staging: string, ps: Pedido[], itens: CatalogItem[]): Promise<string> {
  const lib = libSkillsDir(c.d.paths)
  const meta = { repo: e.repo, commit: e.commit, licenca: e.licenca, estrelas: e.estrelas }
  const feitos: CatalogItem[] = []
  const linhas: string[] = []
  for (const p of ps) {
    const old = itemFor(itens, p.nome)
    if (old?.corporativo) { linhas.push(`${p.nome}: nome de item corporativo, não importado.`); continue }
    const ok = await confirm(c, 'skills_import', `Importar ${p.nome} de ${e.repo} para a biblioteca e ligar neste projeto`, `${p.descricao}\n${source(e)}`)
    if (!ok) { linhas.push(`${p.nome}: ${REFUSED}`); continue }
    if (existsSync(join(lib, p.nome))) {
      const swap = await confirm(c, 'skills_import', `Substituir ${p.nome} na biblioteca?`, `Já existe ${p.nome} na biblioteca; a cópia atual dá lugar à de ${e.repo}.`, 'substituir')
      if (!swap) { linhas.push(`${p.nome}: mantida a cópia que já estava na biblioteca.`); continue }
    }
    copySkill(staging, p.nome, lib, meta)
    const it: CatalogItem = { ...old, id: p.nome, tipo: 'skill', descricao: p.descricao, tags: p.tags }
    upsertCatalog(c.d.paths.lib, it)
    feitos.push(it)
  }
  return finish(c, e, feitos, linhas, feitos.map((f) => join('biblioteca', 'skills', f.id)))
}

async function importPlugin(c: Ctx, e: Staged, it: CatalogItem): Promise<string> {
  const ok = await confirm(c, 'skills_import', `Instalar ${it.id} de ${e.repo} e ligar neste projeto`, `${it.descricao}\n${source(e)}`)
  if (!ok) return REFUSED
  if (!c.d.installed().has(it.id)) {
    // with the item, install adds the store and skips a second scan: the staging was just scanned
    const r = await c.d.install(it.id, it)
    if (!r.ok) throw new Error(r.erro ?? `Falha ao instalar ${it.id}.`)
  }
  upsertCatalog(c.d.paths.lib, it)
  return finish(c, e, [it], [], [])
}

export function createInstallTools() {
  const staged = new Map<string, Staged>()

  async function resolveOrigin(c: Ctx): Promise<unknown> {
    const o = parseOrigin(str(c, 'origem'))
    if ('erro' in o) throw new Error(o.erro)
    const itens = catalog(c)
    if (o.kind === 'catalog') {
      const it = itemFor(itens, o.id)
      if (!it) throw new Error(`${o.id} não está no catálogo.`)
      return { kind: 'catalog', item: it }
    }
    if (corporate(itens, o)) throw new Error(CORPORATE)
    needLibrary(c)
    const root = stagingRoot(c.path)
    const s = stageOrigin(o, root, c.d.git)
    if ('erro' in s) throw new Error(s.erro)
    const meta = await Promise.resolve()
      .then(() => c.d.repoMeta?.(o.owner, o.repo))
      .catch(() => undefined)
    const e: Staged = {
      projectId: c.p.id,
      clone: join(root, `${o.owner}-${o.repo}`),
      repo: `${o.owner}/${o.repo}`,
      commit: s.commit,
      estrelas: meta?.estrelas ?? null,
      licenca: meta?.licenca ?? null,
      kind: s.kind,
      plugins: s.plugins,
      skills: s.skills,
    }
    staged.set(s.dir, e)
    return { kind: s.kind, staging: s.dir, repo: e.repo, commit: e.commit, estrelas: e.estrelas, licenca: e.licenca, plugins: e.plugins, skills: e.skills }
  }

  async function importStaged(c: Ctx): Promise<unknown> {
    const staging = resolve(str(c, 'staging'))
    const e = staged.get(staging)
    const root = real(stagingRoot(c.path))
    const here = real(staging)
    if (!e || e.projectId !== c.p.id || !root || !here || !inside(root, here)) throw new Error(BAD_STAGING)
    const itens = catalog(c)
    needLibrary(c)
    list(c)
    const ps = pedidos(c.args.itens)
    const plugin = e.kind === 'marketplace' ? pluginPlan(c, e, staging, ps, itens) : null
    if (!plugin) for (const p of ps) if (!e.skills.includes(p.nome)) throw new Error(`${p.nome} não está em ${e.repo}.`)
    // checked: from here the download is spent, whatever happens next
    for (const [k, v] of staged) if (v.clone === e.clone) staged.delete(k)
    try {
      const r = await c.d.scanDir(staging)
      if (!r.ok || r.blocked) {
        const why = r.ok ? describeCounts(r.counts) : `scan falhou: ${r.error ?? 'sem relatório'}`
        throw new Error(`Bloqueado pela checagem de segurança: ${why}${r.report ? `. Relatório: ${r.report}` : ''}`)
      }
      return plugin ? await importPlugin(c, e, plugin) : await importSkills(c, e, staging, ps, itens)
    } finally {
      rmSync(e.clone, { recursive: true, force: true })
    }
  }

  return { resolve: resolveOrigin, importStaged }
}
