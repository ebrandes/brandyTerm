import { readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

/** Videos and images for the artifact viewer. Pure: no Electron here. */

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif'
}

/** MIME type of a video or image; null for anything else. */
export function mediaType(path: string): string | null {
  return TYPES[extname(path).toLowerCase()] ?? null
}

/** `Range: bytes=…` → inclusive byte span; null without a header, 'invalid' when it cannot be served. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (!m[1] && !m[2])) return 'invalid'
  let start: number
  let end: number
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  }
  return start >= size || start > end ? 'invalid' : { start, end }
}

/** folders never searched: dependencies and caches (hidden ones are skipped too); render folders like out/ stay */
const SKIP = new Set(['node_modules', 'target', 'vendor', 'Pods', '__pycache__'])
const MAX_DEPTH = 6
const MAX_ENTRIES = 20_000
const MAX_FOUND = 20

/**
 * Videos and images under `root` changed since `sinceMs` (absolute paths): media made by
 * commands (ffmpeg, renders) never goes through Write/Edit. Hidden and dependency folders
 * are skipped and the walk is capped, so a huge project costs at most a few thousand stats.
 */
export function findNewMedia(root: string, sinceMs: number): string[] {
  const found: string[] = []
  let seen = 0
  const walk = (dir: string, depth: number) => {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (++seen > MAX_ENTRIES || found.length >= MAX_FOUND) return
      if (name.startsWith('.')) continue
      const p = join(dir, name)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP.has(name)) walk(p, depth + 1)
      } else if (st.isFile() && st.mtimeMs >= sinceMs && mediaType(name)) found.push(p)
    }
  }
  walk(root, 0)
  return found
}
