import type { Attachment } from './types'
import { api } from './api'

/** A file waiting in the composer; uploaded to the main process when the message is sent. */
export interface PendingFile {
  key: string
  name: string
  mime: string
  image: boolean
  blob: Blob
  /** object URL of `blob`, for the thumbnail */
  url: string
  /** the image before marks, so the marks can be edited again */
  original?: Blob
  marks?: Mark[]
}

export type Tool = 'pen' | 'rect' | 'arrow' | 'pin'
export type Mark =
  | { tool: 'pen'; color: string; points: [number, number][] }
  | { tool: 'rect' | 'arrow'; color: string; a: [number, number]; b: [number, number] }
  | { tool: 'pin'; color: string; at: [number, number]; n: number }

const IMAGE = /^image\/(png|jpeg|gif|webp)$/
/** the API rejects images above ~8000px and resizes anything over ~1568px; 2000 keeps detail and size sane */
const MAX_SIDE = 2000

let seq = 0

export function attachmentUrl(path: string): string {
  return `brandy-att://file/${encodeURIComponent(path)}`
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

async function shrink(file: File): Promise<Blob> {
  if (file.type === 'image/gif') return file
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  if (scale === 1 && file.size < 3.5 * 1024 * 1024) {
    bmp.close()
    return file
  }
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  const type = file.type === 'image/png' && file.size < 6 * 1024 * 1024 ? 'image/png' : 'image/jpeg'
  return new Promise((resolve) => c.toBlob((b) => resolve(b ?? file), type, 0.9))
}

/** Turns pasted/dropped/picked files into composer items; large images are scaled down first. */
export async function toPending(files: File[]): Promise<PendingFile[]> {
  const out: PendingFile[] = []
  for (const f of files) {
    const image = IMAGE.test(f.type)
    const blob = image ? await shrink(f).catch(() => f) : f
    const name = f.name || (image ? `imagem-colada.${blob.type.split('/')[1] ?? 'png'}` : 'arquivo')
    out.push({ key: `f${++seq}`, name, mime: blob.type || f.type, image, blob, url: URL.createObjectURL(blob) })
  }
  return out
}

/** Files from a paste or drop, if any (text pastes are left to the input). */
export function filesOf(data: DataTransfer | null): File[] {
  if (!data) return []
  const files = [...data.files]
  if (files.length) return files
  return [...data.items].filter((i) => i.kind === 'file').flatMap((i) => i.getAsFile() ?? [])
}

export function release(items: PendingFile[]): void {
  for (const i of items) URL.revokeObjectURL(i.url)
}

export async function upload(projectId: string, items: PendingFile[]): Promise<Attachment[]> {
  return Promise.all(
    items.map(async (i) =>
      api.saveAttachment({
        projectId,
        name: i.name,
        mime: i.mime,
        data: new Uint8Array(await i.blob.arrayBuffer()),
        marked: !!i.marks?.length
      })
    )
  )
}
