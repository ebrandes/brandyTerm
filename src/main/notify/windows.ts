// Windows only shows (and routes the click of) a toast from an app with an AppUserModelID that a
// Start Menu shortcut also carries. An installer would create it; this app runs without one.
import { app, shell } from 'electron'
import { join } from 'node:path'
import { diagLog } from '../diag-log.ts'

const APP_ID = 'com.brandyterm.app'

/** Call once the app is ready, before the first notification. */
export function setUpWindowsToasts(icon: string | undefined): void {
  if (process.platform !== 'win32') return
  // run from source, a separate identity: its shortcut points at electron.exe, not at an installed app
  const id = app.isPackaged ? APP_ID : `${APP_ID}.dev`
  const shortcut = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs',
    app.isPackaged ? 'BrandyTerm.lnk' : 'BrandyTerm (dev).lnk')
  const options = {
    target: process.execPath,
    args: app.isPackaged ? '' : `"${app.getAppPath()}"`,
    appUserModelId: id,
    ...(icon?.endsWith('.ico') ? { icon, iconIndex: 0 } : {})
  }
  // 'replace' fails when there is no shortcut yet, 'create' when there already is one
  const written = shell.writeShortcutLink(shortcut, 'replace', options) || shell.writeShortcutLink(shortcut, 'create', options)
  if (!written) diagLog('notify', 'error', 'atalho do Menu Iniciar não foi criado', { shortcut })
  // without the shortcut, the executable path is the identity Windows still accepts in development
  app.setAppUserModelId(written || app.isPackaged ? id : process.execPath)
}
