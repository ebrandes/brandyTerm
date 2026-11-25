// Host side of the calls that only make sense on this machine's disk (folder picker, files). Pure: engine and paths injected.
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import type { FileBytes } from '../../shared/remote/files.ts'
import type { FsEntry } from '../../shared/types.ts'
import { MAX_ARTIFACT, resolveInside } from '../artifact-read.ts'
import { mediaType } from '../artifact-media.ts'
import { MAX_ATTACHMENT, projectDirName } from '../attachment-scope.ts'
import { browseDir } from '../fs-browse.ts'
import { ruleOf } from '../rpc/channels.ts'
import { registry } from '../rpc/registry.ts'

export interface RemoteCallsDeps {
  engine: { addProject(path: string): string }
  /** <userData>/attachments */
  attachmentsRoot: () => string
  /** folder of a real (non-demo) project; null otherwise */
  rootOf: (projectId: string) => string | null | undefined
  home?: () => string
}


const MIMES: Record<string, string> = {
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
  '.csv': 'text/csv', '.html': 'text/html', '.htm': 'text/html', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4'
}
const mimeOf = (p: string): string => mediaType(p) ?? MIMES[extname(p).toLowerCase()] ?? 'application/octet-stream'

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {})

function readCapped(abs: string, max: number): FileBytes {
  if (statSync(abs).size > max) throw new Error(`Arquivo grande demais (máx. ${max / 1024 / 1024} MB)`)
  return { name: basename(abs), mime: mimeOf(abs), data: new Uint8Array(readFileSync(abs)) }
}

export function remoteCalls(deps: RemoteCallsDeps) {
  const home = deps.home ?? homedir
  return {
    /** folders only: a remote picks where a project goes, not which files exist */
    async browse(dir: unknown): Promise<FsEntry[]> {
      return (await browseDir(String(dir ?? '~/'))).filter(e => e.kind === 'dir')
    },
    addPath(path: unknown): string {
      const raw = String(path ?? '')
      const abs = raw === '~' ? home() : raw.startsWith('~/') ? join(home(), raw.slice(2)) : raw
      let dir = false
      try { dir = abs.length > 0 && statSync(abs).isDirectory() } catch { /* missing */ }
      if (!dir) throw new Error('Não é uma pasta')
      return deps.engine.addProject(resolve(abs))
    },
    /** an attachment of that project's own folder (never another project's, never a path outside) */
    attachRead(arg: unknown): FileBytes {
      const { projectId, path } = obj(arg)
      const abs = resolveInside(join(deps.attachmentsRoot(), projectDirName(String(projectId))), String(path ?? ''))
      if (!abs) throw new Error('Arquivo não encontrado')
      return readCapped(abs, MAX_ATTACHMENT)
    },
    artifactBytes(arg: unknown): FileBytes {
      const { projectId, path } = obj(arg)
      const root = deps.rootOf(String(projectId))
      const abs = root ? resolveInside(root, String(path ?? '')) : null
      if (!abs) throw new Error('Arquivo não encontrado')
      return readCapped(abs, MAX_ARTIFACT)
    }
  }
}

export function registerRemoteCalls(deps: RemoteCallsDeps): void {
  const c = remoteCalls(deps)
  registry.add('fs:browse', a => c.browse(a), ruleOf('fs:browse'))
  registry.add('project:add-path', a => c.addPath(a), ruleOf('project:add-path'))
  registry.add('attach:read', a => c.attachRead(a), ruleOf('attach:read'))
  registry.add('artifact:bytes', a => c.artifactBytes(a), ruleOf('artifact:bytes'))
}
