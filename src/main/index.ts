import { app, BrowserWindow, nativeImage, protocol, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Engine } from './engine.ts'
import { JsonStore } from './store.ts'
import { killAll } from './adapters/proc.ts'
import { closeSdkSessions } from './adapters/claude-sdk.ts'
import { killAllTerminals, registerTerminalIpc } from './terminal.ts'
import { ARTIFACT_SCHEME, registerArtifactIpc } from './artifact-ipc.ts'
import { registerRemoteCalls } from './remote/remote-calls.ts'
import { ATTACHMENT_SCHEME, attachmentsRoot, registerAttachmentIpc } from './attachments.ts'
import { registerFsIpc } from './fs-list.ts'
import { Accounts } from './accounts.ts'
import { registerAccountIpc } from './account-ipc.ts'
import { registerArchiveIpc } from './archive-ipc.ts'
import { archiveDirFor } from './archive.ts'
import { setClaudeAuth } from './adapters/auth.ts'
import { loadIdentity } from './remote/identity.ts'
import { startBackground } from './background.ts'
import { startRemote, type Remote } from './remote/index.ts'
import { startClient } from './remote/client-ipc.ts'
import type { RemoteHosts } from './remote/hosts.ts'
import { registerAppIpc } from './app-ipc.ts'
import { registry } from './rpc/registry.ts'
import { bindIpc } from './rpc/ipc.ts'
import { startConnectors } from './connectors/index.ts'
import { registerConnectorsIpc } from './connectors/connectors-ipc.ts'

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
let hosts: RemoteHosts | null = null

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

// A second dev instance on the same Mac: its own data folder and no single-instance lock (nothing reads
// userData at import time, so setting it here, before whenReady, is early enough)
const dataOverride = process.env.BRANDY_USER_DATA ? resolve(process.env.BRANDY_USER_DATA) : null
if (dataOverride) {
  mkdirSync(dataOverride, { recursive: true })
  app.setPath('userData', dataOverride)
}

if (!dataOverride && !app.requestSingleInstanceLock()) app.quit()

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
  hosts = startClient({ engine, remote, getWin: () => win })
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
  registerRemoteCalls({
    engine, attachmentsRoot, rootOf: projectRoot, userData: () => app.getPath('userData'),
    hiddenRoots: () => engine.state.projects.filter((p) => p.remoteHidden && p.path).map((p) => p.path as string)
  })
  const connectors = await startConnectors({ engine, userData: app.getPath('userData'), hosts: hosts ?? undefined, getWin: () => win?.webContents })
  app.once('before-quit', () => void connectors.stop())
  registerConnectorsIpc(connectors.deps)
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
  hosts?.stop()
  void remote?.stop()
  engine?.shutdown()
  killAllTerminals()
  closeSdkSessions()
  killAll()
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
