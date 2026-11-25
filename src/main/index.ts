import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Engine } from './engine.ts'
import { JsonStore } from './store.ts'
import { killAll } from './adapters/proc.ts'
import { closeSdkSessions } from './adapters/claude-sdk.ts'
import { discoverPlugins, installPlugin } from './plugins.ts'
import { killAllTerminals, killTerminal, registerTerminalIpc } from './terminal.ts'
import { registerAttachmentIpc, registerAttachmentScheme, validAttachments } from './attachments.ts'
import { registerFsIpc } from './fs-list.ts'
import { Accounts } from './accounts.ts'
import { registerAccountIpc } from './account-ipc.ts'
import { registerArchiveIpc } from './archive-ipc.ts'
import { archiveDirFor } from './archive.ts'
import { setClaudeAuth } from './adapters/auth.ts'
import { setUserPlugin, userPluginsState } from './user-plugins.ts'
import { updateSettings } from './settings.ts'
import type { AppSettings } from '../shared/types.ts'

const isMac = process.platform === 'darwin'

/** app icon: resources/ in dev, the packaged resources folder in a build */
function iconPath(): string | undefined {
  const res = (process as { resourcesPath?: string }).resourcesPath
  return [join(__dirname, '../../resources/icon.png'), res && join(res, 'icon.png')].find((f): f is string => !!f && existsSync(f))
}
let engine: Engine
let win: BrowserWindow | null = null
let pushTimer: NodeJS.Timeout | null = null

function pushState(): void {
  if (pushTimer || !win || win.isDestroyed()) return
  pushTimer = setTimeout(() => {
    pushTimer = null
    if (win && !win.isDestroyed()) win.webContents.send('state', engine.state)
  }, 40)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1672,
    height: 941,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#17121c',
    show: false,
    title: 'BrandyTerm',
    icon: iconPath(),
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 18, y: 16 } }
      : { titleBarOverlay: { color: '#17121c', symbolColor: '#cfc6dc', height: 40 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('state:get', () => engine.state)
  ipcMain.handle('project:open-folder', async () => {
    const opts = { title: 'Abrir pasta como projeto', properties: ['openDirectory' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    return engine.addProject(res.filePaths[0])
  })
  ipcMain.handle('project:remove', (_e, id: string) => {
    killTerminal(String(id))
    engine.removeProject(String(id))
  })
  ipcMain.handle('chat:send', (_e, a: { projectId: string; text: string; threadId?: string; attachments?: unknown }) =>
    engine.send(String(a.projectId), String(a.text ?? ''), a.threadId ? String(a.threadId) : undefined, validAttachments(a.attachments))
  )
  ipcMain.handle('commands:list', (_e, projectId: string) => engine.commands(String(projectId)))
  ipcMain.handle('process:start', (_e, a: { projectId: string; name: string; command: string }) =>
    engine.startProcess(String(a.projectId), String(a.name ?? ''), String(a.command ?? ''))
  )
  ipcMain.handle('process:stop', (_e, a: { projectId: string; processId: string }) =>
    engine.stopProcess(String(a.projectId), String(a.processId))
  )
  ipcMain.handle('process:remove', (_e, a: { projectId: string; processId: string }) =>
    engine.removeProcess(String(a.projectId), String(a.processId))
  )
  ipcMain.handle('process:open-port', (_e, port: number) => {
    const n = Number(port)
    if (Number.isInteger(n) && n > 0 && n < 65536) void shell.openExternal(`http://localhost:${n}`)
  })
  ipcMain.handle('plugin:install', async (_e, a: { id: string; force?: boolean }) => {
    const p = engine.state.plugins.find((x) => x.id === String(a.id))
    if (!p || p.dir || p.installing) return
    p.installing = true
    p.error = undefined
    p.review = undefined
    p.note = a.force ? 'instalando…' : 'Claude Security revisando o plugin…'
    engine.emit('change')
    const r = await installPlugin(p.id, !!a.force)
    const fresh = discoverPlugins()
    fresh.forEach((x) => {
      if (x.id !== p.id) return
      x.review = r.review
      if (!r.ok && !r.review?.blocked) x.error = r.error
    })
    engine.state.plugins = fresh
    engine.emit('change')
  })
  ipcMain.handle('plugin:open-report', (_e, id: string) => {
    const report = engine.state.plugins.find((x) => x.id === String(id))?.review?.report
    if (report) void shell.openPath(report)
  })
  ipcMain.handle('thread:approve', (_e, a: { projectId: string; threadId: string; id: string; decision: string }) => {
    const d = a.decision === 'allow' || a.decision === 'always' || a.decision === 'all' ? a.decision : 'deny'
    engine.respondApproval(String(a.projectId), String(a.threadId), String(a.id), d)
  })
  ipcMain.handle('thread:allowAll', (_e, a: { projectId: string; threadId: string; on: boolean }) => engine.setAllowAll(String(a.projectId), String(a.threadId), !!a.on))
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    engine.state.settings = updateSettings(patch ?? {})
    engine.touch()
  })
  ipcMain.handle('thread:resolve', (_e, a: { projectId: string; threadId: string }) => engine.resolveThread(String(a.projectId), String(a.threadId)))
  ipcMain.handle('thread:cancel', (_e, a: { projectId: string; threadId: string }) =>
    engine.cancelThread(String(a.projectId), String(a.threadId))
  )
}

registerAttachmentScheme()

/** reads each account's limits at startup unless they are fresh (each check is a tiny Haiku run) */
async function refreshLimits(accounts: Accounts): Promise<void> {
  for (const a of [...accounts.state.list]) {
    const age = a.checkedAt ? Date.now() - Date.parse(a.checkedAt) : Infinity
    if (age > 30 * 60 * 1000) await accounts.probe(a.id)
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

app.whenReady().then(async () => {
  const stateFile = join(app.getPath('userData'), 'brandyterm-state.json')
  engine = new Engine(new JsonStore(stateFile))
  engine.on('change', pushState)
  // accounts first: every Claude run (even the ones init may start) bills the active account
  const accounts = new Accounts()
  accounts.init()
  setClaudeAuth(accounts.auth())
  engine.state.accounts = accounts.state
  accounts.on('change', pushState)
  await engine.init()
  engine.state.accounts = accounts.state
  registerAccountIpc(accounts)
  registerArchiveIpc(engine, archiveDirFor(stateFile))
  ipcMain.handle('userPlugins:set', (_e, a: { id: string; on: boolean }) => {
    setUserPlugin(String(a.id), !!a.on)
    engine.state.userPlugins = userPluginsState()
    pushState()
  })
  void refreshLimits(accounts)
  registerIpc()
  registerAttachmentIpc()
  const projectRoot = (id: string) => {
    const p = engine.state.projects.find((x) => x.id === id)
    return p && !p.demo ? p.path : null
  }
  registerTerminalIpc(projectRoot)
  registerFsIpc(projectRoot)
  const icon = iconPath()
  if (isMac && icon) app.dock?.setIcon(nativeImage.createFromPath(icon))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  engine?.shutdown()
  killAllTerminals()
  closeSdkSessions()
  killAll()
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
