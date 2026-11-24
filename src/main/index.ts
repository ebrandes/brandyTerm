import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { Engine } from './engine.ts'
import { JsonStore } from './store.ts'
import { killAll } from './adapters/proc.ts'

const isMac = process.platform === 'darwin'
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
  ipcMain.handle('project:remove', (_e, id: string) => engine.removeProject(String(id)))
  ipcMain.handle('chat:send', (_e, a: { projectId: string; text: string; threadId?: string }) =>
    engine.send(String(a.projectId), String(a.text), a.threadId ? String(a.threadId) : undefined)
  )
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
  ipcMain.handle('thread:cancel', (_e, a: { projectId: string; threadId: string }) =>
    engine.cancelThread(String(a.projectId), String(a.threadId))
  )
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

app.whenReady().then(async () => {
  engine = new Engine(new JsonStore(join(app.getPath('userData'), 'brandyterm-state.json')))
  engine.on('change', pushState)
  await engine.init()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  engine?.shutdown()
  killAll()
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
