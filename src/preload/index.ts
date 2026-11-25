import { contextBridge, ipcRenderer } from 'electron'
import type { BrandyApi } from '../shared/api'
import type { AppState } from '../shared/types'

function listen<T>(channel: string, cb: (e: T) => void): () => void {
  const h = (_: unknown, e: T) => cb(e)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

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
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  send: (a) => ipcRenderer.invoke('chat:send', a),
  saveAttachment: (a) => ipcRenderer.invoke('attach:save', a),
  openAttachment: (p) => ipcRenderer.invoke('attach:open', p),
  readArtifact: (a) => ipcRenderer.invoke('artifact:read', a),
  openArtifact: (a) => ipcRenderer.invoke('artifact:open', a),
  listCommands: (id) => ipcRenderer.invoke('commands:list', id),
  listFiles: (a) => ipcRenderer.invoke('fs:list', a),
  cancelThread: (a) => ipcRenderer.invoke('thread:cancel', a),
  approveTool: (a) => ipcRenderer.invoke('thread:approve', a),
  resolveThread: (a) => ipcRenderer.invoke('thread:resolve', a),
  setAllowAll: (a) => ipcRenderer.invoke('thread:allowAll', a),
  listArchived: (ids) => ipcRenderer.invoke('archive:list', ids),
  reopenArchived: (a) => ipcRenderer.invoke('archive:reopen', a),
  startProcess: (a) => ipcRenderer.invoke('process:start', a),
  stopProcess: (a) => ipcRenderer.invoke('process:stop', a),
  removeProcess: (a) => ipcRenderer.invoke('process:remove', a),
  openPort: (p) => ipcRenderer.invoke('process:open-port', p),
  installPlugin: (a) => ipcRenderer.invoke('plugin:install', a),
  openPluginReport: (id) => ipcRenderer.invoke('plugin:open-report', id),
  setUserPlugin: (a) => ipcRenderer.invoke('userPlugins:set', a),
  accounts: {
    activate: (id) => ipcRenderer.invoke('accounts:activate', id),
    setAuto: (on) => ipcRenderer.invoke('accounts:auto', on),
    rename: (a) => ipcRenderer.invoke('accounts:rename', a),
    remove: (id) => ipcRenderer.invoke('accounts:remove', id),
    probe: (id) => ipcRenderer.invoke('accounts:probe', id),
    addToken: (a) => ipcRenderer.invoke('accounts:add-token', a),
    loginStart: (a) => ipcRenderer.invoke('accounts:login-start', a),
    loginCancel: () => ipcRenderer.invoke('accounts:login-cancel')
  },
  term: {
    open: (a) => ipcRenderer.invoke('term:open', a),
    write: (a) => ipcRenderer.invoke('term:write', a),
    resize: (a) => ipcRenderer.invoke('term:resize', a),
    kill: (id) => ipcRenderer.invoke('term:kill', id),
    onData: (cb) => listen('term:data', cb),
    onExit: (cb) => listen('term:exit', cb),
    readClipboard: () => ipcRenderer.invoke('clipboard:read'),
    writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text)
  }
}

contextBridge.exposeInMainWorld('brandy', api)
