import { app, net, protocol, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MAX_FILES, type Attachment } from '../shared/types.ts'
import { inside } from './paths.ts'
import { insideProjectFolder, projectDirName } from './attachment-scope.ts'
import { registry } from './rpc/registry.ts'
import { ruleOf } from './rpc/channels.ts'

/**
 * Files the user pastes, drops or picks in the composer. They are copied to
 * <userData>/attachments/<projectId>/ so a message keeps pointing at them, and are
 * served to the renderer through the brandy-att:// scheme for thumbnails.
 */

export const MAX_ATTACHMENT = 25 * 1024 * 1024
const TEXT_EXT = new Set(
  '.txt .md .markdown .json .jsonc .yaml .yml .toml .ini .env .csv .tsv .xml .html .htm .css .scss .less .js .jsx .ts .tsx .mjs .cjs .py .rb .go .rs .java .kt .swift .c .h .cpp .hpp .cs .php .sh .zsh .bash .sql .graphql .vue .svelte .log .diff .patch'.split(
    ' '
  )
)
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export function attachmentsRoot(): string {
  return join(app.getPath('userData'), 'attachments')
}

function kindOf(name: string, mime: string): Attachment['kind'] {
  if (IMAGE_MIME.has(mime)) return 'image'
  if (mime === 'application/pdf' || extname(name).toLowerCase() === '.pdf') return 'pdf'
  if (mime.startsWith('text/') || TEXT_EXT.has(extname(name).toLowerCase()) || mime === 'application/json') return 'text'
  return 'file'
}

function safeName(name: string): string {
  const clean = name.replace(/[/\\?%*:|"<>\x00-\x1f]/g, '_').trim() || 'arquivo'
  return clean.slice(-80)
}

/** true when `p` is a file inside the attachments folder (the renderer never picks arbitrary paths) */
function owned(p: string): boolean {
  return inside(attachmentsRoot(), resolve(p)) && existsSync(p)
}

export function saveAttachment(projectId: string, name: string, mime: string, data: Uint8Array, marked: boolean): Attachment {
  if (data.byteLength > MAX_ATTACHMENT) throw new Error(`Arquivo grande demais (máx. ${MAX_ATTACHMENT / 1024 / 1024} MB)`)
  const id = randomUUID()
  const dir = join(attachmentsRoot(), projectDirName(projectId))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${id.slice(0, 8)}-${safeName(name)}`)
  writeFileSync(file, data)
  return { id, name: safeName(name), kind: kindOf(name, mime), mime: mime || 'application/octet-stream', size: data.byteLength, path: file, marked }
}

/** Keeps only attachments the app stored itself; with `onlyProject` (remote calls), only that project's own folder. */
export function validAttachments(list: unknown, onlyProject?: string): Attachment[] {
  if (!Array.isArray(list)) return []
  const ok = (p: string): boolean => owned(p) && (onlyProject === undefined || insideProjectFolder(attachmentsRoot(), onlyProject, p))
  return list.filter((a): a is Attachment => !!a && typeof a.path === 'string' && typeof a.name === 'string' && ok(a.path)).slice(0, MAX_FILES)
}

export function removeProjectAttachments(projectId: string): void {
  rmSync(join(attachmentsRoot(), projectDirName(projectId)), { recursive: true, force: true })
}

/** privileges of brandy-att://; registered with the other schemes in one call (index.ts) */
export const ATTACHMENT_SCHEME = { scheme: 'brandy-att', privileges: { standard: true, secure: true, supportFetchAPI: true } }

export function registerAttachmentIpc(): void {
  // brandy-att://file/<url-encoded absolute path>
  protocol.handle('brandy-att', (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname.slice(1))
    if (!owned(p)) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(p).toString())
  })
  registry.add('attach:save', (a: { projectId: string; name: string; mime: string; data: Uint8Array; marked?: boolean }) =>
    saveAttachment(String(a.projectId), String(a.name ?? ''), String(a.mime ?? ''), a.data, !!a.marked),
    ruleOf('attach:save'))
  registry.add('attach:open', (p: string) => {
    if (owned(String(p))) void shell.openPath(String(p))
  }, ruleOf('attach:open'))
}
