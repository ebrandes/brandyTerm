import { execFile } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { inside } from './paths.ts'
import { newFileSummary, parseUnifiedDiff, type FileDiff } from '../shared/diff-summary.ts'

/**
 * Read-only `git diff` of one project file for the artifact viewer. Git runs without a
 * shell, never writes the index (GIT_OPTIONAL_LOCKS=0) and ignores the repo's external
 * diff, textconv and fsmonitor programs, so opening the viewer runs nothing from the repo.
 */

/** git's empty tree: the base when the repository has no commit yet */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
/** a new file bigger than this is not read to count its lines */
const MAX_NEW = 20 * 1024 * 1024
const SAFE = ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false', '-c', 'diff.noprefix=false']

/**
 * `rel` as a path relative to the real project folder, when it names something inside it.
 * The file may be gone (a deleted file still has a diff): then its nearest existing folder
 * must be inside. Symlinks are resolved; absolute paths, `..` escapes and NUL are refused.
 */
export function diffPathInside(root: string, rel: string): string | null {
  if (!rel || rel.includes('\0') || isAbsolute(rel) || /^[a-z]:/i.test(rel)) return null
  try {
    const realRoot = realpathSync(root)
    const lexical = resolve(realRoot, rel)
    if (!inside(realRoot, lexical)) return null
    let real: string
    if (existsSync(lexical)) {
      real = realpathSync(lexical)
      if (!statSync(real).isFile()) return null
    } else {
      let dir = dirname(lexical)
      while (!existsSync(dir)) dir = dirname(dir)
      const realDir = realpathSync(dir)
      if (realDir !== realRoot && !inside(realRoot, realDir)) return null
      real = resolve(realDir, relative(dir, lexical))
    }
    if (!inside(realRoot, real)) return null
    return relative(realRoot, real).split(sep).join('/')
  } catch {
    return null
  }
}

interface Run {
  code: number
  out: string
  err: string
}

function git(cwd: string, args: string[]): Promise<Run> {
  return new Promise((done) => {
    execFile(
      'git',
      [...SAFE, ...args],
      { cwd, timeout: 10_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GIT_PAGER: 'cat' }, windowsHide: true },
      (e, out, err) => {
        const code = e ? (typeof (e as { code?: unknown }).code === 'number' ? ((e as { code: number }).code) : -1) : 0
        done({ code, out: String(out), err: String(err) })
      }
    )
  })
}

/** Diff of a project file against the last commit; a file git does not track counts as new. */
export async function fileDiff(root: string, rel: string): Promise<FileDiff> {
  const path = diffPathInside(root, rel)
  if (!path) return { kind: 'invalid' }
  const cwd = realpathSync(root)
  // 0: has a commit; 1: a repository with no commit yet; anything else: not a repository (or no git)
  const head = await git(cwd, ['rev-parse', '--verify', '-q', 'HEAD'])
  if (head.code !== 0 && head.code !== 1) return { kind: 'not-git' }
  const tracked = await git(cwd, ['ls-files', '--error-unmatch', '--', path])
  if (tracked.code !== 0) return untracked(cwd, path)
  const base = head.code === 0 ? 'HEAD' : EMPTY_TREE
  const d = await git(cwd, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-U2', base, '--', path])
  if (d.code !== 0) return { kind: 'error', error: d.err.trim().split('\n')[0] || 'git diff falhou' }
  return { kind: 'ok', summary: parseUnifiedDiff(d.out) }
}

/** A file git does not know: every line is new (the same as `git diff --no-index /dev/null file`, without the process). */
function untracked(cwd: string, path: string): FileDiff {
  const abs = resolve(cwd, path)
  try {
    if (!existsSync(abs)) return { kind: 'ok', summary: { ...newFileSummary(''), isNew: false, deleted: true } }
    if (statSync(abs).size > MAX_NEW) return { kind: 'error', error: 'Arquivo grande demais para resumir.' }
    const buf = readFileSync(abs)
    // a NUL in the first 8 KB is how git itself tells binary from text
    if (buf.subarray(0, 8000).includes(0)) return { kind: 'ok', summary: { ...newFileSummary(''), binary: true } }
    return { kind: 'ok', summary: newFileSummary(buf.toString('utf8')) }
  } catch {
    return { kind: 'error', error: 'Não deu para ler o arquivo.' }
  }
}
