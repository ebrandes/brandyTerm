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
  renameProject: (a) => ipcRenderer.invoke('project:rename', a),
  setProjectArchived: (a) => ipcRenderer.invoke('project:archive', a),
  clearCoordinatorContext: (a) => ipcRenderer.invoke('project:clear-context', a),
  revealProject: (a) => ipcRenderer.invoke('project:reveal', a),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setRemoteHidden: (a) => ipcRenderer.invoke('project:set-remote-hidden', a),
  send: (a) => ipcRenderer.invoke('chat:send', a),
  saveAttachment: (a) => ipcRenderer.invoke('attach:save', a),
  openAttachment: (p) => ipcRenderer.invoke('attach:open', p),
  readArtifact: (a) => ipcRenderer.invoke('artifact:read', a),
  diffArtifact: (a) => ipcRenderer.invoke('artifact:diff', a),
  openArtifact: (a) => ipcRenderer.invoke('artifact:open', a),
  listCommands: (id) => ipcRenderer.invoke('commands:list', id),
  listFiles: (a) => ipcRenderer.invoke('fs:list', a),
  cancelThread: (a) => ipcRenderer.invoke('thread:cancel', a),
  approveTool: (a) => ipcRenderer.invoke('thread:approve', a),
  resolveThread: (a) => ipcRenderer.invoke('thread:resolve', a),
  retireThread: (a) => ipcRenderer.invoke('thread:retire', a),
  setAllowAll: (a) => ipcRenderer.invoke('thread:allowAll', a),
  listArchived: (ids) => ipcRenderer.invoke('archive:list', ids),
  reopenArchived: (a) => ipcRenderer.invoke('archive:reopen', a),
  startProcess: (a) => ipcRenderer.invoke('process:start', a),
  stopProcess: (a) => ipcRenderer.invoke('process:stop', a),
  removeProcess: (a) => ipcRenderer.invoke('process:remove', a),
  openPort: (p) => ipcRenderer.invoke('process:open-port', p),
  installPlugin: (a) => ipcRenderer.invoke('plugin:install', a),
  openPluginReport: (id) => ipcRenderer.invoke('plugin:open-report', id),
  openLogs: () => ipcRenderer.invoke('logs:open'),
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
  connectors: {
    presets: () => ipcRenderer.invoke('connectors:presets'),
    add: (a) => ipcRenderer.invoke('connectors:add', a),
    update: (a) => ipcRenderer.invoke('connectors:update', a),
    remove: (a) => ipcRenderer.invoke('connectors:remove', a),
    enable: (a) => ipcRenderer.invoke('connectors:enable', a),
    test: (a) => ipcRenderer.invoke('connectors:test', a),
    login: (a) => ipcRenderer.invoke('connectors:login', a),
    loginCancel: (a) => ipcRenderer.invoke('connectors:login-cancel', a),
    revokeAlways: (a) => ipcRenderer.invoke('connectors:revoke-always', a),
    importList: () => ipcRenderer.invoke('connectors:import-list'),
    import: (a) => ipcRenderer.invoke('connectors:import', a)
  },
  remote: {
    hosts: () => ipcRenderer.invoke('remote:hosts'),
    onHosts: (cb) => listen('remote:hosts', cb),
    onState: (cb) => listen('remote:state', cb),
    states: () => ipcRenderer.invoke('remote:states'),
    call: (a) => ipcRenderer.invoke('remote:call', a),
    openBytes: (a) => ipcRenderer.invoke('remote:open-bytes', a),
    status: () => ipcRenderer.invoke('remote:status'),
    openPairing: () => ipcRenderer.invoke('remote:open-pairing'),
    closePairing: () => ipcRenderer.invoke('remote:close-pairing'),
    devices: () => ipcRenderer.invoke('remote:devices'),
    revoke: (a) => ipcRenderer.invoke('remote:revoke', a),
    setTerminal: (a) => ipcRenderer.invoke('remote:set-terminal', a),
    discovered: () => ipcRenderer.invoke('remote:discovered'),
    discover: (on) => ipcRenderer.invoke('remote:discover', on),
    pair: (a) => ipcRenderer.invoke('remote:pair', a),
    rename: (name) => ipcRenderer.invoke('remote:rename', name)
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
