import { ipcMain, net, protocol, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import { readArtifact, resolveInside } from './artifact-read.ts'

/**
 * Artifact viewer access to project files. `artifact:read` returns text for the
 * renderer; `brandy-art://p/<projectId>/<relative path>` serves HTML, SVG and images
 * to a sandboxed iframe under a CSP that blocks every script and network request.
 */

export const ARTIFACT_CSP = "default-src 'none'; img-src brandy-art: data:; style-src 'unsafe-inline'"

type RootOf = (projectId: string) => string | null | undefined

export function registerArtifactScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'brandy-art', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

/** `brandy-art://p/<projectId>/<path>` → [projectId, relative path] */
function parse(url: string): [string, string] | null {
  const u = new URL(url)
  if (u.hostname !== 'p') return null
  const [, id, ...rest] = u.pathname.split('/')
  if (!id || !rest.length) return null
  return [decodeURIComponent(id), rest.map(decodeURIComponent).join('/')]
}

export function registerArtifactIpc(rootOf: RootOf): void {
  protocol.handle('brandy-art', async (req) => {
    const target = parse(req.url)
    const root = target && rootOf(target[0])
    const abs = root ? resolveInside(root, target[1]) : null
    if (!abs) return new Response('not found', { status: 404 })
    const file = await net.fetch(pathToFileURL(abs).toString())
    const headers = new Headers(file.headers)
    headers.set('Content-Security-Policy', ARTIFACT_CSP)
    headers.set('X-Content-Type-Options', 'nosniff')
    return new Response(file.body, { status: file.status, headers })
  })
  ipcMain.handle('artifact:read', (_e, a: { projectId: string; path: string }) => {
    const root = rootOf(String(a?.projectId))
    return root ? readArtifact(root, String(a?.path ?? '')) : { kind: 'missing' }
  })
  ipcMain.handle('artifact:open', (_e, a: { projectId: string; path: string }) => {
    const root = rootOf(String(a?.projectId))
    const abs = root ? resolveInside(root, String(a?.path ?? '')) : null
    if (abs) void shell.openPath(abs)
  })
}
