import { contextBridge, ipcRenderer } from 'electron'
import type { BrandyApi } from '../shared/api'
import type { AppState } from '../shared/types'

const api: BrandyApi = {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => {
    const h = (_: unknown, s: AppState) => cb(s)
    ipcRenderer.on('state', h)
    return () => ipcRenderer.removeListener('state', h)
  },
  openFolder: () => ipcRenderer.invoke('project:open-folder'),
  removeProject: (id) => ipcRenderer.invoke('project:remove', id),
  send: (a) => ipcRenderer.invoke('chat:send', a),
  cancelThread: (a) => ipcRenderer.invoke('thread:cancel', a),
  startProcess: (a) => ipcRenderer.invoke('process:start', a),
  stopProcess: (a) => ipcRenderer.invoke('process:stop', a),
  removeProcess: (a) => ipcRenderer.invoke('process:remove', a),
  openPort: (p) => ipcRenderer.invoke('process:open-port', p)
}

contextBridge.exposeInMainWorld('brandy', api)
