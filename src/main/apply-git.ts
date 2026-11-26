import { execFile } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The git side of the deferred apply: no shell, and none of the repo's external diff, textconv or
 * fsmonitor programs. `git apply` is all or nothing and never touches the index.
 */

const SAFE = [
  '-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false',
  '-c', 'diff.noprefix=false', '-c', 'diff.mnemonicprefix=false'
]

interface Run {
  code: number
  out: string
  err: string
}

function run(cwd: string, args: string[]): Promise<Run> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GIT_PAGER: 'cat' }
  // the folder alone says which repository: an inherited GIT_DIR must not redirect an apply
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k]
  return new Promise((done) => {
    execFile('git', [...SAFE, ...args], { cwd, env, timeout: 60_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (e, out, err) => {
      const code = e ? (typeof e.code === 'number' ? e.code : 1) : 0
      done({ code, out: String(out), err: String(err) || (e ? e.message : '') })
    })
  })
}

async function must(cwd: string, args: string[]): Promise<string> {
  const r = await run(cwd, args)
  if (r.code !== 0) throw new Error(r.err.trim().slice(0, 600) || `git ${args[0]} falhou`)
  return r.out
}

export function realDir(path: string): string {
  try { return realpathSync(path) } catch { return resolve(path) }
}

export const toplevel = async (dir: string): Promise<string> => realDir((await must(dir, ['rev-parse', '--show-toplevel'])).trim())

export interface Worktree {
  path: string
  branch: string
}

export async function worktrees(root: string): Promise<Worktree[]> {
  const blocks = (await must(root, ['worktree', 'list', '--porcelain'])).split(/\r?\n\r?\n/)
  return blocks.flatMap((b) => {
    const path = /^worktree (.+)$/m.exec(b)?.[1]
    const branch = /^branch refs\/heads\/(.+)$/m.exec(b)?.[1] ?? '(sem branch)'
    return path ? [{ path: realDir(path), branch }] : []
  })
}

export const isClean = async (dir: string): Promise<boolean> => !(await must(dir, ['status', '--porcelain'])).trim()

export const commitOf = async (dir: string, rev: string): Promise<string> =>
  (await must(dir, ['rev-parse', '--verify', '--end-of-options', `${rev}^{commit}`])).trim()

export const mergeBase = async (root: string, a: string, b: string): Promise<string> => (await must(root, ['merge-base', a, b])).trim()

export const changedFiles = async (root: string, base: string, head: string): Promise<string[]> =>
  (await must(root, ['diff', '--no-renames', '--name-only', base, head, '--'])).split('\n').filter(Boolean)

/** git writes the file itself, so no byte goes through a text decoding. False when there is no change. */
export async function makePatch(root: string, base: string, head: string, file: string): Promise<boolean> {
  await must(root, ['diff', '--binary', '--full-index', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', `--output=${file}`, base, head, '--'])
  return statSync(file).size > 0
}

const APPLY = ['apply', '--whitespace=nowarn']

/** why the patch does not fit the folder, or null when it does (nothing is written) */
export async function checkPatch(root: string, file: string): Promise<string | null> {
  const r = await run(root, [...APPLY, '--check', file])
  return r.code === 0 ? null : r.err.trim().slice(0, 600) || 'git apply --check falhou'
}

/** the folder already holds the patched content */
export const isApplied = async (root: string, file: string): Promise<boolean> =>
  (await run(root, [...APPLY, '--reverse', '--check', file])).code === 0

export const applyPatch = async (root: string, file: string): Promise<void> => void (await must(root, [...APPLY, file]))
