import { useCallback, useState } from 'react'
import { release, toPending, type Mark, type PendingFile } from './attach'

/** Files waiting in each composer (key = project:thread), like the text drafts. */
export function useDraftFiles() {
  const [all, setAll] = useState<Record<string, PendingFile[]>>({})

  const add = useCallback(async (key: string, files: File[]) => {
    const items = await toPending(files)
    setAll((s) => ({ ...s, [key]: [...(s[key] ?? []), ...items] }))
  }, [])

  const remove = useCallback((key: string, fileKey: string) => {
    setAll((s) => {
      release((s[key] ?? []).filter((f) => f.key === fileKey))
      return { ...s, [key]: (s[key] ?? []).filter((f) => f.key !== fileKey) }
    })
  }, [])

  /** swaps the image for its marked version, keeping the original to edit the marks again */
  const mark = useCallback((key: string, fileKey: string, blob: Blob, marks: Mark[], original: Blob) => {
    setAll((s) => ({
      ...s,
      [key]: (s[key] ?? []).map((f) => {
        if (f.key !== fileKey) return f
        URL.revokeObjectURL(f.url)
        const url = URL.createObjectURL(blob)
        return { ...f, blob, url, marks, original, mime: marks.length ? 'image/png' : original.type || f.mime }
      })
    }))
  }, [])

  const clear = useCallback((key: string) => {
    setAll((s) => {
      release(s[key] ?? [])
      return { ...s, [key]: [] }
    })
  }, [])

  return { get: (key: string) => all[key] ?? [], add, remove, mark, clear }
}
