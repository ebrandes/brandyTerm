import { useSyncExternalStore } from 'react'
import type { ThreadFile } from './types'

/** What the artifact viewer shows: a project file, or a diagram taken from an answer. */
export type ArtifactTarget = { projectId: string; path: string } | { inline: 'mermaid'; code: string }

let current: ArtifactTarget | null = null
const subs = new Set<() => void>()
const notify = () => subs.forEach((f) => f())

export function showArtifact(target: ArtifactTarget): void {
  current = target
  notify()
}

export function closeArtifact(): void {
  current = null
  notify()
}

export function useArtifact(): ArtifactTarget | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => current
  )
}

/** `brandy-art://` URL of a project file, for the sandboxed iframe and Markdown images. */
export function artifactUrl(projectId: string, path: string): string {
  return `brandy-art://p/${encodeURIComponent(projectId)}/${path.split('/').map(encodeURIComponent).join('/')}`
}

/** Joins a relative `src` from a Markdown file to the file's folder; null for absolute or external sources. */
export function resolveRelative(fileDir: string, src: string): string | null {
  if (!src || /^[a-z][\w+.-]*:/i.test(src) || src.startsWith('/') || src.startsWith('#')) return null
  const parts = fileDir ? fileDir.split('/') : []
  for (const seg of src.split(/[?#]/)[0].split('/')) {
    if (seg === '..') {
      if (!parts.length) return null
      parts.pop()
    } else if (seg && seg !== '.') {
      try {
        parts.push(decodeURIComponent(seg))
      } catch {
        return null
      }
    }
  }
  return parts.join('/')
}

/** An image in a Markdown artifact: inside the project via brandy-art, web and data as they are, anything else blank. */
export function markdownImageSrc(projectId: string, fileDir: string, src: string): string {
  if (/^(https?:|data:)/i.test(src)) return src
  const rel = resolveRelative(fileDir, src)
  return rel ? artifactUrl(projectId, rel) : ''
}

/** A fenced block that no backtick run inside `text` can close early. */
export function fenced(text: string, lang = ''): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((m) => m.length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${lang}\n${text}\n${fence}`
}

/**
 * The files of one run, for the summary at `index` in `messages`: written after the
 * previous summary of the same thread and up to this one.
 */
export function filesForSummary(
  files: ThreadFile[],
  messages: { time: string; summaries?: { threadId?: string }[] }[],
  index: number,
  threadId: string
): ThreadFile[] {
  const until = Date.parse(messages[index]?.time ?? '') || Infinity
  let since = -Infinity
  for (let i = index - 1; i >= 0; i--) {
    if (messages[i].summaries?.some((s) => s.threadId === threadId)) {
      since = Date.parse(messages[i].time) || -Infinity
      break
    }
  }
  return files.filter((f) => {
    const at = Date.parse(f.at)
    return at > since && at <= until
  })
}
