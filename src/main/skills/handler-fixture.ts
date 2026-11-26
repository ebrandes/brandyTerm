// Test helper for handler*.test.ts: a temp project, a temp library and fakes for every side effect.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ApprovalAsk } from '../adapters/types.ts'
import type { ApprovalDecision, CatalogItem, Project, Thread } from '../../shared/types.ts'
import type { ScanResult } from '../security.ts'
import { upsertCatalog } from './catalog.ts'
import { createSkillsHandler, type SkillsDeps } from './handler.ts'
import type { GitRun } from './library.ts'
import { skillsPaths } from './paths.ts'

export const item = (id: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  tipo: id.includes('@') ? 'plugin' : 'skill',
  descricao: `sobre ${id}`,
  tags: [],
  ...extra,
})

export interface FixtureOpts {
  itens?: CatalogItem[]
  /** null: a thread that is not a skills thread */
  skillsTask?: Thread['skillsTask'] | null
  /** card answers in order; once used up, every card is allowed */
  answers?: ApprovalDecision[]
  installed?: string[]
  scan?: ScanResult
  /** files the fake `git clone` writes into its target (no real skill content) */
  repo?: Record<string, string>
  /** no `.git` in the library folder */
  noLib?: boolean
  repoMeta?: SkillsDeps['repoMeta']
  /** stores this machine already knows: name → source repo */
  knownMarkets?: Record<string, string>
}

export function write(root: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
}

export function fixture(t: { after(fn: () => void): void }, o: FixtureOpts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'skills-h-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const project = join(root, 'proj')
  mkdirSync(project)
  const paths = skillsPaths(join(root, 'ud'))
  if (!o.noLib) mkdirSync(join(paths.lib, '.git'), { recursive: true })
  for (const i of o.itens ?? []) upsertCatalog(paths.lib, i)
  const thread = { id: 't1', skillsTask: o.skillsTask === null ? undefined : (o.skillsTask ?? 'init') } as Thread
  const p = { id: 'p1', path: project, threads: [thread] } as unknown as Project
  const asks: ApprovalAsk[] = []
  const installs: { id: string; item?: CatalogItem }[] = []
  const scans: string[] = []
  const gitCalls: string[][] = []
  const changed: string[] = []
  const answers = [...(o.answers ?? [])]
  const git: GitRun = (args) => {
    gitCalls.push(args)
    if (args[0] === 'clone') {
      write(args.at(-1)!, o.repo ?? {})
      return { code: 0, out: '' }
    }
    if (args.includes('rev-parse')) return { code: 0, out: 'abc1234\n' }
    // `diff --cached --quiet` exits 1 when something is staged
    if (args.includes('diff')) return { code: 1, out: '' }
    return { code: 0, out: '' }
  }
  const deps: SkillsDeps = {
    paths,
    findThread: (r) => (r.threadId === 't1' ? { p, t: thread } : undefined),
    ask: async (_t, a) => {
      asks.push(a)
      return answers.shift() ?? 'allow'
    },
    install: async (id, it) => {
      installs.push({ id, item: it })
      return { ok: true }
    },
    scanDir: async (dir) => {
      scans.push(dir)
      return o.scan ?? { ok: true, counts: {}, blocked: false }
    },
    installed: () => new Map((o.installed ?? []).map((id) => [id, `/plugins/${id}`])),
    repoMeta: o.repoMeta ?? (async () => ({ estrelas: 120, licenca: 'MIT' })),
    knownMarket: (name) => o.knownMarkets?.[name] ?? null,
    git,
    changed: (id) => changed.push(id),
  }
  const handle = createSkillsHandler(deps)
  const call = (tool: string, args: unknown = {}, signal = new AbortController().signal) =>
    handle({ projectId: 'p1', threadId: 't1' }, { id: 1, token: 'x', op: 'skills', tool, args }, signal)
  return { root, project, paths, thread, asks, installs, scans, gitCalls, changed, call }
}
