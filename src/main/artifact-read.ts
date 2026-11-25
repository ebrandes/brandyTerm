import { readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import type { ArtifactContent, ArtifactKind } from '../shared/types.ts'
import { inside } from './paths.ts'
import { mediaType } from './artifact-media.ts'

/** Reading a thread's artifact for the viewer. Pure: no Electron here. */

export const MAX_ARTIFACT = 2 * 1024 * 1024

const KINDS: Record<string, ArtifactKind> = {
  '.md': 'md',
  '.markdown': 'md',
  '.mmd': 'mermaid',
  '.mermaid': 'mermaid',
  '.html': 'html',
  '.htm': 'html',
  '.svg': 'svg'
}

/** How the viewer renders a file, from its extension. */
export function artifactKind(path: string): { kind: ArtifactKind; lang?: string } {
  const ext = extname(path).toLowerCase()
  const kind = KINDS[ext]
  return kind ? { kind } : { kind: 'code', lang: ext ? ext.slice(1) : undefined }
}

/** Real path of `rel` when it is a file inside `root` (symlinks resolved); null otherwise. */
export function resolveInside(root: string, rel: string): string | null {
  if (!rel) return null
  try {
    const realRoot = realpathSync(root)
    const abs = realpathSync(resolve(realRoot, rel))
    return inside(realRoot, abs) && statSync(abs).isFile() ? abs : null
  } catch {
    return null
  }
}

/** Contents of an artifact; anything unreadable or outside the project reads as missing. */
export function readArtifact(root: string, rel: string): ArtifactContent {
  const abs = resolveInside(root, rel)
  if (!abs) return { kind: 'missing' }
  try {
    const size = statSync(abs).size
    // media is streamed by brandy-art://, never read here: no size cap
    const media = mediaType(abs)
    if (media) return { kind: media.startsWith('video/') ? 'video' : 'image', size }
    if (size > MAX_ARTIFACT) return { kind: 'too-big', size }
    const { kind, lang } = artifactKind(abs)
    const text = readFileSync(abs, 'utf8')
    return lang ? { kind, text, lang } : { kind, text }
  } catch {
    // unreadable, or deleted between the check and the read
    return { kind: 'missing' }
  }
}

/** Content type with utf-8 for HTML/SVG, so pages without a <meta charset> keep their accents; null for anything else. */
export function textContentType(path: string): string | null {
  const { kind } = artifactKind(path)
  if (kind === 'html') return 'text/html; charset=utf-8'
  if (kind === 'svg') return 'image/svg+xml; charset=utf-8'
  return null
}

/** `brandy-art://p/<projectId>/<path>` → [projectId, relative path]; null when malformed. */
export function parseArtifactUrl(url: string): [string, string] | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'brandy-art:' || u.hostname !== 'p') return null
    const [, id, ...rest] = u.pathname.split('/')
    if (!id || !rest.length || !rest.join('')) return null
    return [decodeURIComponent(id), rest.map(decodeURIComponent).join('/')]
  } catch {
    return null
  }
}
