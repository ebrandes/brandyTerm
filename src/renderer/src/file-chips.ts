// Pure helpers for the compact file row under a thread summary.
import type { ThreadFile } from './types'

/** Build output and dependencies (`out/`, `dist/`, `node_modules/` at any depth): not something the thread wrote by hand. */
const BUILD_OUTPUT = /(^|\/)(out|dist|node_modules)\//

export const isBuildOutput = (path: string): boolean => BUILD_OUTPUT.test(path.replace(/\\/g, '/').replace(/^\.\//, ''))

/** The files worth showing, newest first, without build output. */
export function summaryFiles(files: ThreadFile[]): ThreadFile[] {
  return files.filter((f) => !isBuildOutput(f.path)).reverse()
}

export const fileName = (path: string): string => path.split('/').pop() || path

/** How many chips fit in `avail` px: all of them, or as many as fit beside the '+N…' button (at least one). */
export function fitCount(widths: number[], avail: number, moreWidth: number, gap: number): number {
  if (!widths.length) return 0
  const total = widths.reduce((sum, w, i) => sum + w + (i ? gap : 0), 0)
  if (total <= avail) return widths.length
  let used = moreWidth
  let n = 0
  for (const w of widths) {
    if (used + gap + w > avail) break
    used += gap + w
    n++
  }
  return Math.max(1, n)
}
