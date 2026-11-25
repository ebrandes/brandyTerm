// A file of a paired machine's project, shown here: images and video from their bytes (blob: URLs, the
// brandy-art:/brandy-att: protocols only serve this machine's files), pages (HTML, SVG) never. No DOM.
import type { BrandyApi } from '../../../shared/api.ts'
import type { FileBytes } from '../../../shared/remote/files.ts'
import type { ArtifactContent } from '../../../shared/types.ts'
import { parseId, routeCall } from './route.ts'

export type HostChannel = 'artifact:bytes' | 'attach:read'
export interface HostRead { machineId: string; channel: HostChannel; arg: unknown }

/** what the viewer shows instead of the local protocol: media from bytes, or a note for a page */
const HOST_KINDS: Record<string, 'media' | 'page'> = { image: 'media', video: 'media', html: 'page', svg: 'page' }

/** How a file of `projectId` with that content kind is shown when it lives on another machine; null = as usual. */
export function hostView(projectId: string, kind: ArtifactContent['kind']): 'media' | 'page' | null {
  return parseId(projectId).machineId === null ? null : HOST_KINDS[kind] ?? null
}

/** The host call that returns the bytes of a remote project's file; null for this machine's projects. */
export function hostRead(channel: HostChannel, projectId: string, path: string): HostRead | null {
  const r = routeCall(channel, { projectId, path })
  return r.machineId === null ? null : { machineId: r.machineId, channel, arg: r.arg }
}

/** Reads the file on its machine and hands it to `toUrl` as a Blob of its type (URL.createObjectURL in the app). */
export async function hostBlob(api: Pick<BrandyApi, 'remote'>, read: HostRead, toUrl: (b: Blob) => string): Promise<string> {
  const f = (await api.remote.call(read)) as FileBytes
  return toUrl(new Blob([f.data as Uint8Array<ArrayBuffer>], { type: f.mime }))
}
