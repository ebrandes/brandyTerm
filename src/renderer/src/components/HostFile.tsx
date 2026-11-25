import { useEffect, useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { ArtifactContent } from '../types'
import { api } from '../api'
import { report } from '../notice'
import { hostBlob, hostRead, hostView, type HostRead } from '../remote/host-file'
import './host-file.css'

/** blob: URL of a file read on its machine; revoked when the view goes away. undefined while loading, null on failure. */
function useHostBlob(read: HostRead | null): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  const key = read ? JSON.stringify(read) : ''
  useEffect(() => {
    if (!read) return
    let live = true
    let made: string | null = null
    setUrl(undefined)
    hostBlob(api, read, (b) => (made = URL.createObjectURL(b))).then(
      (u) => (live ? setUrl(u) : URL.revokeObjectURL(u)),
      () => live && setUrl(null)
    )
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [key]) // `key` is `read` by value: a new object for the same file does not refetch
  return url
}

const FAILED = 'Não foi possível ler o arquivo na outra máquina.'

/** Image, video or page of a remote project in the viewer: media from its bytes, a page never (only "Abrir"). */
export function HostFile({ target, kind }: { target: { projectId: string; path: string }; kind: ArtifactContent['kind'] }) {
  const page = hostView(target.projectId, kind) === 'page'
  const read = useMemo(
    () => (page ? null : hostRead('artifact:bytes', target.projectId, target.path)),
    [page, target.projectId, target.path]
  )
  const url = useHostBlob(read)
  if (page)
    return (
      <div className="host-page">
        <p className="art-note">Páginas e SVG de outra máquina não são exibidos aqui.</p>
        <button onClick={() => void api.openArtifact(target).catch(report)}>
          <ExternalLink size={14} /> Abrir
        </button>
      </div>
    )
  if (url === undefined) return <p className="art-note">Carregando…</p>
  if (url === null) return <p className="art-note">{FAILED}</p>
  if (kind === 'video') return <video className="art-media" src={url} controls autoPlay playsInline />
  return <img className="art-media" src={url} alt={target.path} />
}

/** Thumbnail of an image attachment of a remote project (MessageFiles). */
export function HostThumb({ projectId, path, name }: { projectId: string; path: string; name: string }) {
  const read = useMemo(() => hostRead('attach:read', projectId, path), [projectId, path])
  const url = useHostBlob(read)
  if (!url) return <span className="host-thumb">{url === null ? FAILED : 'Carregando…'}</span>
  return <img src={url} alt={name} loading="lazy" />
}
