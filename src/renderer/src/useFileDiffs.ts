import { useEffect, useState } from 'react'
import type { FileDiff } from '../../shared/diff-summary.ts'
import { api } from './api'

/** loading is shown until the main answers */
export type DiffState = FileDiff | { kind: 'loading' }

/** at most this many git diffs run at once for the file list */
const PARALLEL = 4

/**
 * Diffs of the viewer's files, read once per viewer opening (the cache lives while the
 * viewer is mounted). New paths load as they appear; a failed call reads as an error.
 */
export function useFileDiffs(projectId: string, paths: string[]): Record<string, DiffState> {
  const [diffs, setDiffs] = useState<Record<string, DiffState>>({})
  const wanted = paths.join('\n')
  useEffect(() => {
    let live = true
    const todo = wanted.split('\n').filter((p) => p && !(p in diffs))
    if (!todo.length) return
    setDiffs((d) => ({ ...d, ...Object.fromEntries(todo.map((p) => [p, { kind: 'loading' } as const])) }))
    const next = async (): Promise<void> => {
      const path = todo.shift()
      if (!path || !live) return
      const r: FileDiff = await api.diffArtifact({ projectId, path }).catch((e: unknown) => ({ kind: 'error' as const, error: String((e as Error)?.message ?? e) }))
      if (live) setDiffs((d) => ({ ...d, [path]: r }))
      return next()
    }
    void Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, next))
    return () => {
      live = false
    }
    // `diffs` is read only to skip paths already asked for
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, wanted])
  return diffs
}

/** `+X −Y` of a loaded diff; null while loading or when there is nothing to count. */
export function diffStat(d: DiffState | undefined): { added: number; removed: number } | null {
  if (!d || d.kind !== 'ok' || d.summary.binary) return null
  return { added: d.summary.added, removed: d.summary.removed }
}
