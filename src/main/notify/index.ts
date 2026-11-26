// Native notifications: watches this machine's engine and the paired machines, and brings the window to a clicked target.
import { app, Notification, type BrowserWindow } from 'electron'
import type { NotifyTarget } from '../../shared/api.ts'
import type { AppState } from '../../shared/types.ts'
import type { Engine } from '../engine.ts'
import type { RemoteHosts } from '../remote/hosts.ts'
import { appSettings } from '../settings.ts'
import { registry } from '../rpc/registry.ts'
import { ruleOf } from '../rpc/channels.ts'
import { diagLog } from '../diag-log.ts'
import { createNotifications } from './service.ts'
import { setUpWindowsToasts } from './windows.ts'

export interface NotifyWiring {
  engine: Engine
  hosts: RemoteHosts | null
  getWin: () => BrowserWindow | null
  createWindow: () => void
  icon: string | undefined
}

/** a garbage view from the renderer counts as "seeing nothing" */
function asView(v: unknown): NotifyTarget | null {
  const o = v as NotifyTarget | null
  if (typeof o?.projectId !== 'string') return null
  return { projectId: o.projectId, threadId: typeof o.threadId === 'string' ? o.threadId : undefined }
}

function bringUp(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  if (process.platform === 'darwin') {
    app.show()
    app.focus({ steal: true })
  } else win.moveTop()
  win.focus()
}

export function startNotifications({ engine, hosts, getWin, createWindow, icon }: NotifyWiring): void {
  setUpWindowsToasts(icon)
  // a collected Notification loses its click handler; the latest ones stay referenced (Action Center)
  const kept: Notification[] = []
  const service = createNotifications({
    enabled: () => appSettings().notifications !== false && Notification.isSupported(),
    focused: () => {
      const win = getWin()
      return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused()
    },
    show: (text, onClick) => {
      const note = new Notification({ ...text, ...(process.platform === 'win32' && icon ? { icon } : {}) })
      note.on('click', onClick)
      kept.push(note)
      if (kept.length > 50) kept.shift()
      note.show()
    },
    open: () => {
      const win = getWin()
      // a window created now takes the target when it mounts
      if (!win || win.isDestroyed()) return createWindow()
      bringUp(win)
      win.webContents.send('notify:open')
    }
  })

  // a notification problem must never interrupt whoever changed the state
  const safely = (fn: () => void): void => {
    try {
      fn()
    } catch (e) {
      diagLog('notify', 'error', 'falha ao notificar', { error: String(e) })
    }
  }
  const local = (): void => safely(() => service.observe('local', engine.state.projects))
  local() // what is already there at boot is the baseline
  engine.on('change', local)
  // paired machines: ids as the renderer namespaces them (renderer/src/remote/route.ts)
  hosts?.on('state', ({ machineId, state }: { machineId: string; state: AppState }) =>
    safely(() => service.observe(machineId, state.projects, (id) => `@${machineId}/${id}`)))

  registry.add('notify:view', (view: unknown) => service.setView(asView(view)), ruleOf('notify:view'))
  registry.add('notify:take-target', () => service.takeTarget(), ruleOf('notify:take-target'))
}
