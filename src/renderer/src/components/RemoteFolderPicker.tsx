import { useEffect, useState } from 'react'
import { ChevronUp, Folder } from 'lucide-react'
import type { FsEntry } from '../types'
import { api } from '../api'
import { remoteId } from '../remote/route'
import { parentDir } from '../remote/parent-dir'
import './remote-picker.css'

const asProjectPath = (p: string): string => (p === '~/' ? '~' : p.length > 1 ? p.replace(/\/+$/, '') : p)

/** Folder picker for another machine: lists its folders (fs:browse) and opens one as a project there (project:add-path). */
export function RemoteFolderPicker({ machineId, machineName, onDone }: { machineId: string; machineName: string; onDone: (projectId: string | null) => void }) {
  const [dir, setDir] = useState('~/')
  const [items, setItems] = useState<FsEntry[] | null>(null)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setItems(null)
    setError(undefined)
    api.remote.call({ machineId, channel: 'fs:browse', arg: dir }).then(
      (r) => { if (live) setItems(r as FsEntry[]) },
      (e) => { if (live) { setItems([]); setError(String(e?.message ?? e)) } }
    )
    return () => { live = false }
  }, [machineId, dir])

  const open = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const id = (await api.remote.call({ machineId, channel: 'project:add-path', arg: asProjectPath(dir) })) as string
      onDone(remoteId(machineId, id))
    } catch (e) {
      setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setBusy(false)
    }
  }

  return (
    <div className="modal-back" onClick={() => onDone(null)}>
      <div className="modal rfp" role="dialog" aria-label={`Abrir pasta em ${machineName}`} onClick={(e) => e.stopPropagation()}>
        <h3>Abrir pasta em {machineName}</h3>
        <div className="rfp-path">
          <button className="icon-btn sm" aria-label="Pasta acima" title="Pasta acima" disabled={dir === '/' || dir === '~/'} onClick={() => setDir(parentDir(dir))}>
            <ChevronUp size={14} />
          </button>
          <code>{dir}</code>
        </div>
        <div className="rfp-list">
          {items === null && <p className="rfp-note">Carregando…</p>}
          {items?.length === 0 && <p className="rfp-note">Nenhuma subpasta.</p>}
          {items?.map((f) => (
            <button key={f.path} className="rfp-item" onClick={() => setDir(f.path)}>
              <Folder size={14} /> {f.path.replace(/\/$/, '').split('/').pop()}
            </button>
          ))}
        </div>
        {error && <p className="rfp-error">{error}</p>}
        <div className="modal-actions">
          <button onClick={() => onDone(null)}>Cancelar</button>
          <button className="primary" disabled={busy || dir === '~/'} title={dir === '~/' ? 'Entre em uma pasta' : undefined} onClick={() => void open()}>Abrir como projeto</button>
        </div>
      </div>
    </div>
  )
}
