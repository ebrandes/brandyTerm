import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { realGit, type GitRun } from './library.ts'
import type { GithubOrigin } from './origin.ts'

export interface Staged {
  /** the folder to analyse: the clone, or `sub` inside it */
  dir: string
  commit: string
  kind: 'marketplace' | 'skills'
  plugins: string[]
  skills: string[]
}

const NOTHING = { erro: 'Não achei plugin nem skill nesse repositório.' }

function marketplacePlugins(dir: string): string[] | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, '.claude-plugin', 'marketplace.json'), 'utf8'))
    if (!Array.isArray(raw?.plugins)) return null
    return raw.plugins.map((p: { name?: unknown }) => p?.name).filter((n: unknown): n is string => typeof n === 'string' && !!n)
  } catch {
    return null
  }
}

function skillNames(dir: string): string[] {
  if (existsSync(join(dir, 'SKILL.md'))) return [basename(dir)]
  try {
    return readdirSync(join(dir, 'skills'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(dir, 'skills', e.name, 'SKILL.md')))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * Clones a GitHub origin into `<stagingRoot>/<owner>-<repo>` for analysis (old copy
 * removed first) and says what it holds. `stagingRoot` sits under `<projeto>/.brandyterm/tmp`,
 * which gets a `*` .gitignore so a staged copy never lands in the project's git.
 */
export function stageOrigin(o: GithubOrigin, stagingRoot: string, git: GitRun = realGit): Staged | { erro: string } {
  const tmp = dirname(stagingRoot)
  mkdirSync(stagingRoot, { recursive: true })
  if (!existsSync(join(tmp, '.gitignore'))) writeFileSync(join(tmp, '.gitignore'), '*\n')
  const clone = join(stagingRoot, `${o.owner}-${o.repo}`)
  rmSync(clone, { recursive: true, force: true })
  const url = `https://github.com/${o.owner}/${o.repo}.git`
  const args = ['clone', '--depth', '1', ...(o.ref ? ['--branch', o.ref] : []), url, clone]
  const r = git(args, stagingRoot)
  if (r.code !== 0) return { erro: `Não consegui baixar ${o.owner}/${o.repo}: ${r.out || 'git clone falhou'}` }
  const commit = git(['-C', clone, 'rev-parse', 'HEAD'], clone).out.trim()
  const dir = o.sub ? join(clone, ...o.sub.split('/')) : clone
  if (!existsSync(dir)) return { erro: `A pasta ${o.sub} não existe nesse repositório.` }
  const plugins = marketplacePlugins(dir)
  if (plugins?.length) return { dir, commit, kind: 'marketplace', plugins, skills: [] }
  const skills = skillNames(dir)
  if (skills.length) return { dir, commit, kind: 'skills', plugins: [], skills }
  return NOTHING
}
