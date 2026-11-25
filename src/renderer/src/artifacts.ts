import { useSyncExternalStore } from 'react'

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
    } else if (seg && seg !== '.') parts.push(decodeURIComponent(seg))
  }
  return parts.join('/')
}

/** A fenced block that no backtick run inside `text` can close early. */
export function fenced(text: string, lang = ''): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((m) => m.length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${lang}\n${text}\n${fence}`
}
