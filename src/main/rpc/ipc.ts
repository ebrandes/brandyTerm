import { ipcMain } from 'electron'
import type { Registry } from './registry.ts'

/** exposes every registered channel to the renderer; call once, after all registrations */
export function bindIpc(r: Registry): void {
  for (const channel of r.channels()) {
    ipcMain.handle(channel, (e, a) => r.invoke(channel, a, { sender: e.sender }))
  }
}
