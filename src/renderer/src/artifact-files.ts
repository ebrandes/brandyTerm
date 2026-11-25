import { viewerFiles } from '../../shared/diff-summary.ts'
import type { ThreadFile } from './types'

interface ThreadLike {
  id: string
  files?: ThreadFile[]
}

/**
 * The files the viewer lists beside a project file: those of the thread that opened it
 * (`threadId`), or else of the thread that wrote `path` last. Build output is left out;
 * an empty list means no thread is known for this file.
 */
export function viewerThreadFiles(threads: ThreadLike[], path: string, threadId?: string): ThreadFile[] {
  let thread = threadId ? threads.find((t) => t.id === threadId) : undefined
  if (!thread) {
    let last = ''
    for (const t of threads)
      for (const f of t.files ?? [])
        if (f.path === path && f.at > last) {
          last = f.at
          thread = t
        }
  }
  return viewerFiles(thread?.files ?? [])
}
