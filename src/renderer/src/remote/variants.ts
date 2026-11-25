// Remote variants of the calls that are local-only on a machine (folder dialog, open file, open port). No DOM/Electron.
import type { BrandyApi } from '../../../shared/api.ts'
import type { FileBytes } from '../../../shared/remote/files.ts'
import { requestRemoteFolder } from './folder-picker-bus.ts'
import { parseId, routeCall } from './route.ts'
import { portUrl } from './port-url.ts'

export type Variants = Pick<BrandyApi, 'openFolder' | 'openAttachment' | 'openArtifact' | 'openPort'>

export function createVariants(local: BrandyApi, openUrl: (url: string) => void): Variants {
  /** a file of the host's disk, read there and opened here (passive formats) or just shown in its folder */
  async function openFromHost(machineId: string, channel: string, arg: unknown): Promise<void> {
    const f = (await local.remote.call({ machineId, channel, arg })) as FileBytes
    await local.remote.openBytes({ machineId, name: f.name, data: f.data })
  }

  return {
    openFolder: machineId => (machineId ? requestRemoteFolder(machineId) : local.openFolder()),
    openAttachment: (path, projectId) => {
      const r = routeCall('attach:read', { projectId, path })
      return r.machineId === null ? local.openAttachment(path, projectId) : openFromHost(r.machineId, 'attach:read', r.arg)
    },
    openArtifact: a => {
      const r = routeCall('artifact:bytes', a)
      return r.machineId === null ? local.openArtifact(a) : openFromHost(r.machineId, 'artifact:bytes', r.arg)
    },
    async openPort(port, projectId) {
      const machineId = parseId(projectId).machineId
      if (machineId === null) return local.openPort(port, projectId)
      const host = (await local.remote.hosts()).find(h => h.machine.id === machineId)
      const name = host?.machine.name ?? 'Máquina'
      if (!host?.online) throw new Error(`${name} está offline`)
      const url = portUrl(host.address, port)
      if (!url) throw new Error(host.address ? 'Porta inválida' : `${name} está offline`)
      openUrl(url)
    }
  }
}
