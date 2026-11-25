import { net, protocol, shell } from 'electron'
import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { mediaType, parseRange } from './artifact-media.ts'
import { parseArtifactUrl, readArtifact, resolveInside, textContentType } from './artifact-read.ts'
import { registry } from './rpc/registry.ts'
import { ruleOf } from './rpc/channels.ts'

/**
 * Artifact viewer access to project files. `artifact:read` returns text for the
 * renderer; `brandy-art://p/<projectId>/<relative path>` serves HTML, SVG and images
 * to a sandboxed iframe under a CSP that blocks every script and network request.
 */

export const ARTIFACT_CSP = "default-src 'none'; img-src brandy-art: data:; style-src 'unsafe-inline'"

type RootOf = (projectId: string) => string | null | undefined

/** privileges of brandy-art://; registered with the other schemes in one call (index.ts) */
export const ARTIFACT_SCHEME = { scheme: 'brandy-art', privileges: { standard: true, secure: true, supportFetchAPI: true } }

export function registerArtifactIpc(rootOf: RootOf): void {
  protocol.handle('brandy-art', async (req) => {
    const target = parseArtifactUrl(req.url)
    const root = target && rootOf(target[0])
    const abs = root ? resolveInside(root, target[1]) : null
    if (!abs) return new Response('not found', { status: 404 })
    const media = mediaType(abs)
    if (media) return streamMedia(abs, media, req.headers.get('range'))
    const file = await net.fetch(pathToFileURL(abs).toString())
    const headers = new Headers(file.headers)
    headers.set('Content-Security-Policy', ARTIFACT_CSP)
    headers.set('X-Content-Type-Options', 'nosniff')
    const type = textContentType(abs)
    if (type) headers.set('Content-Type', type)
    return new Response(file.body, { status: file.status, headers })
  })
  registry.add('artifact:read', (a: { projectId: string; path: string }) => {
    const root = rootOf(String(a?.projectId))
    return root ? readArtifact(root, String(a?.path ?? '')) : { kind: 'missing' }
  }, ruleOf('artifact:read'))
  registry.add('artifact:open', (a: { projectId: string; path: string }) => {
    const root = rootOf(String(a?.projectId))
    const abs = root ? resolveInside(root, String(a?.path ?? '')) : null
    if (abs) void shell.openPath(abs)
  }, ruleOf('artifact:open'))
}

/** Video/image bytes with Range support, so the player can seek without loading the whole file. */
function streamMedia(abs: string, type: string, range: string | null): Response {
  const size = statSync(abs).size
  const span = parseRange(range, size)
  const headers = new Headers({ 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Security-Policy': ARTIFACT_CSP, 'X-Content-Type-Options': 'nosniff' })
  if (span === 'invalid') {
    headers.set('Content-Range', `bytes */${size}`)
    return new Response(null, { status: 416, headers })
  }
  const { start, end } = span ?? { start: 0, end: size - 1 }
  headers.set('Content-Length', String(size ? end - start + 1 : 0))
  if (span) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
  const body = size ? (Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream) : null
  return new Response(body, { status: span ? 206 : 200, headers })
}
