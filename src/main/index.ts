import { app, BrowserWindow, nativeImage, protocol, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Engine } from './engine.ts'
import { JsonStore } from './store.ts'
import { killAll } from './adapters/proc.ts'
import { closeSdkSessions } from './adapters/claude-sdk.ts'
import { killAllTerminals, registerTerminalIpc } from './terminal.ts'
import { ARTIFACT_SCHEME, registerArtifactIpc } from './artifact-ipc.ts'
import { ATTACHMENT_SCHEME, registerAttachmentIpc } from './attachments.ts'
import { registerFsIpc } from './fs-list.ts'
import { Accounts } from './accounts.ts'
import { registerAccountIpc } from './account-ipc.ts'
import { registerArchiveIpc } from './archive-ipc.ts'
import { archiveDirFor } from './archive.ts'
import { setClaudeAuth } from './adapters/auth.ts'
import { loadIdentity } from './remote/identity.ts'
import { startBackground } from './background.ts'
import { startRemote, type Remote } from './remote/index.ts'
import { registerAppIpc } from './app-ipc.ts'
import { registry } from './rpc/registry.ts'
import { bindIpc } from './rpc/ipc.ts'

const isMac = process.platform === 'darwin'

/** app icon: resources/ in dev, the packaged resources folder in a build */
function iconPath(): string | undefined {
  const res = (process as { resourcesPath?: string }).resourcesPath
  return [join(__dirname, '../../resources/icon.png'), res && join(res, 'icon.png')].find((f): f is string => !!f && existsSync(f))
}
let engine: Engine
let win: BrowserWindow | null = null
let pushTimer: NodeJS.Timeout | null = null

let stopBackground = (): void => {}
let remote: Remote | null = null

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

// Electron keeps only the last call: every privileged scheme goes in this one
protocol.registerSchemesAsPrivileged([ATTACHMENT_SCHEME, ARTIFACT_SCHEME])

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
  engine.state.machine = loadIdentity()
  engine.state.accounts = accounts.state
  registerAccountIpc(accounts)
  registerArchiveIpc(engine, archiveDirFor(stateFile))
  stopBackground = startBackground(engine)
  remote = startRemote(engine)
  void refreshLimits(accounts)
  registerAppIpc({ engine, getWin: () => win, pushState })
  registerAttachmentIpc()
  const projectRoot = (id: string) => {
    const p = engine.state.projects.find((x) => x.id === id)
    return p && !p.demo ? p.path : null
  }
  registerTerminalIpc(projectRoot)
  registerFsIpc(projectRoot)
  registerArtifactIpc(projectRoot)
  bindIpc(registry)
  const icon = iconPath()
  if (isMac && icon) app.dock?.setIcon(nativeImage.createFromPath(icon))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopBackground()
  void remote?.stop()
  engine?.shutdown()
  killAllTerminals()
  closeSdkSessions()
  killAll()
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
