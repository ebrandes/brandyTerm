import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_LIBRARY } from '../../shared/skills.ts'

export { DEFAULT_LIBRARY }

export type GitRun = (args: string[], cwd: string) => { code: number; out: string }

/** Real git: never prompts for credentials, gives up after two minutes. */
export const realGit: GitRun = (args, cwd) => {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }
}

const SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const HTTPS = /^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9_.\/-]+$/

/** `dono/repo` → GitHub https URL; a full https URL passes through. Anything else throws. */
export function libraryUrl(setting?: string): string {
  const s = (setting ?? DEFAULT_LIBRARY).trim()
  if (SLUG.test(s) && !s.includes('..')) return `https://github.com/${s.replace(/\.git$/, '')}.git`
  if (HTTPS.test(s) && !s.includes('..')) return s
  throw new Error('biblioteca inválida')
}

/** Clones the library when absent, else fast-forwards it. Failure keeps whatever is on disk. */
export function syncLibrary(url: string, dir: string, git: GitRun = realGit): { ok: boolean; aviso?: string } {
  if (existsSync(join(dir, '.git'))) {
    if (git(['-C', dir, 'pull', '--ff-only'], dir).code === 0) return { ok: true }
    return { ok: false, aviso: 'Biblioteca sem atualizar (sem rede?): usando a cópia que já existe.' }
  }
  const parent = dirname(dir)
  mkdirSync(parent, { recursive: true })
  if (git(['clone', '--depth', '50', url, dir], parent).code === 0) return { ok: true }
  return { ok: false, aviso: 'Biblioteca indisponível: skills da biblioteca ficam como "falta instalar".' }
}

const sameRepo = (a: string, b: string) => a.trim().replace(/\/+$/, '').replace(/\.git$/, '') === b.trim().replace(/\/+$/, '').replace(/\.git$/, '')

/**
 * Points the library at `url`. A clone of another repo (or one without origin) is moved to
 * `<dir>-antiga-<ms>` and kept, never deleted: it may hold unpushed commits. Then it syncs.
 */
export function switchLibrary(url: string, dir: string, git: GitRun = realGit): { ok: boolean; aviso?: string; antiga?: string } {
  let antiga: string | undefined
  if (existsSync(join(dir, '.git'))) {
    const cur = git(['-C', dir, 'remote', 'get-url', 'origin'], dir)
    if (cur.code !== 0 || !sameRepo(cur.out, url)) {
      antiga = `${dir}-antiga-${Date.now()}`
      renameSync(dir, antiga)
    }
  }
  const r = syncLibrary(url, dir, git)
  return antiga ? { ...r, antiga } : r
}

/** Stages `paths` and commits them; `false` when nothing changed (or the commit failed). */
export function commitLibrary(dir: string, message: string, paths: string[], git: GitRun = realGit): boolean {
  if (git(['-C', dir, 'add', '--', ...paths], dir).code !== 0) return false
  if (git(['-C', dir, 'diff', '--cached', '--quiet'], dir).code === 0) return false
  return git(['-C', dir, 'commit', '-m', message], dir).code === 0
}

export function pushLibrary(dir: string, git: GitRun = realGit): { ok: boolean; erro?: string } {
  const r = git(['-C', dir, 'push'], dir)
  return r.code === 0 ? { ok: true } : { ok: false, erro: r.out || 'git push falhou' }
}
