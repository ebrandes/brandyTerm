// Short diff of one project file for the artifact viewer: counts and the hunks only. Pure.

export type DiffLineKind = '+' | '-' | ' '

export interface DiffLine {
  t: DiffLineKind
  text: string
}

export interface DiffHunk {
  /** the `@@ -a,b +c,d @@ …` line */
  header: string
  lines: DiffLine[]
}

/** What `artifact:diff` answers for one file. */
export type FileDiff =
  /** the project folder is not inside a git repository (or git is missing) */
  | { kind: 'not-git' }
  /** path empty, outside the project, through a symlink that leaves it, or unknown project */
  | { kind: 'invalid' }
  | { kind: 'error'; error: string }
  | { kind: 'ok'; summary: DiffSummary }

export interface DiffSummary {
  added: number
  removed: number
  /** a file git does not know yet (or one added since the last commit) */
  isNew: boolean
  deleted: boolean
  binary: boolean
  hunks: DiffHunk[]
  /** hunks or lines were dropped to keep the answer small */
  truncated: boolean
}

/** most lines sent to the renderer across all hunks */
export const MAX_DIFF_LINES = 1500
/** hunks longer than this start folded behind "mostrar mais" */
export const FOLD_AT = 14
/** lines a folded hunk still shows */
export const FOLDED_LINES = 8

const EMPTY: DiffSummary = { added: 0, removed: 0, isNew: false, deleted: false, binary: false, hunks: [], truncated: false }

/** Summary of a `git diff` patch of a single file (unified format). Lines past MAX_DIFF_LINES still count, but are not kept. */
export function parseUnifiedDiff(patch: string, maxLines = MAX_DIFF_LINES): DiffSummary {
  const s: DiffSummary = { ...EMPTY, hunks: [] }
  let hunk: DiffHunk | null = null
  let kept = 0
  for (const raw of patch.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.startsWith('@@')) {
      hunk = { header: line, lines: [] }
      if (kept < maxLines) s.hunks.push(hunk)
      else s.truncated = true
      continue
    }
    if (!hunk) {
      if (line.startsWith('new file mode') || line === '--- /dev/null') s.isNew = true
      else if (line.startsWith('deleted file mode') || line === '+++ /dev/null') s.deleted = true
      else if (line.startsWith('Binary files ') || line === 'GIT binary patch') s.binary = true
      continue
    }
    if (line.startsWith('diff --git ')) {
      hunk = null
      continue
    }
    const t = line[0]
    if (t !== '+' && t !== '-' && t !== ' ') continue // "\ No newline at end of file", the trailing empty line
    if (t === '+') s.added++
    else if (t === '-') s.removed++
    if (kept < maxLines) {
      hunk.lines.push({ t, text: line.slice(1) })
      kept++
    } else s.truncated = true
  }
  return s
}

/** Summary of a file git does not track yet: every line is new. Text with a NUL byte reads as binary. */
export function newFileSummary(text: string): DiffSummary {
  if (text.includes('\0')) return { ...EMPTY, hunks: [], isNew: true, binary: true }
  return { ...EMPTY, hunks: [], isNew: true, added: countLines(text) }
}

/** Lines of a text file: a final newline does not start another line. */
export function countLines(text: string): number {
  if (!text) return 0
  const n = text.split('\n').length
  return text.endsWith('\n') ? n - 1 : n
}

/** The lines a hunk shows: all of them, or the first FOLDED_LINES when it is long and folded. */
export function visibleLines(hunk: DiffHunk, open: boolean): { lines: DiffLine[]; hidden: number } {
  if (open || hunk.lines.length <= FOLD_AT) return { lines: hunk.lines, hidden: 0 }
  return { lines: hunk.lines.slice(0, FOLDED_LINES), hidden: hunk.lines.length - FOLDED_LINES }
}

/** Build output and dependencies never show in the viewer's file list. */
export const IGNORED_DIR = /(^|\/)(out|dist|node_modules)\//

/** The files of a thread for the viewer's list: newest write first, one entry per path, build output left out. */
export function viewerFiles<T extends { path: string; at: string }>(files: T[]): T[] {
  const latest = new Map<string, T>()
  for (const f of files) {
    if (IGNORED_DIR.test(f.path.replace(/\\/g, '/'))) continue
    const prev = latest.get(f.path)
    if (!prev || prev.at <= f.at) latest.set(f.path, f)
  }
  return [...latest.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}
