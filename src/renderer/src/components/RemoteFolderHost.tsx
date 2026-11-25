import { useEffect, useState } from 'react'
import { onRemoteFolderRequest } from '../remote/folder-picker-bus'
import { api } from '../api'
import { RemoteFolderPicker } from './RemoteFolderPicker'

type Open = { machineId: string; name: string; resolve: (projectId: string | null) => void }

/** Shows the picker whenever the renderer calls api.openFolder(machineId); mount it once. */
export function RemoteFolderHost() {
  const [open, setOpen] = useState<Open | null>(null)
  useEffect(() => onRemoteFolderRequest(async ({ machineId, resolve }) => {
    const host = (await api.remote.hosts().catch(() => [])).find((h) => h.machine.id === machineId)
    setOpen({ machineId, name: host?.machine.name ?? 'outra máquina', resolve })
  }), [])
  if (!open) return null
  const done = (id: string | null) => { open.resolve(id); setOpen(null) }
  return <RemoteFolderPicker machineId={open.machineId} machineName={open.name} onDone={done} />
}
