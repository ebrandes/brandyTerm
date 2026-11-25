import { powerSaveBlocker } from 'electron'
import type { Project } from '../shared/types.ts'
import { shouldStayAwake } from '../shared/idle.ts'

/**
 * Holds one power-save blocker while a thread or the coordinator works, so a long run
 * does not stall when the machine sleeps. Display may still sleep (prevent-app-suspension).
 */
export class KeepAwake {
  private id: number | null = null

  sync(projects: Project[], enabled: boolean): void {
    const want = enabled && shouldStayAwake(projects)
    if (want && (this.id === null || !powerSaveBlocker.isStarted(this.id))) {
      this.id = powerSaveBlocker.start('prevent-app-suspension')
    } else if (!want && this.id !== null) {
      if (powerSaveBlocker.isStarted(this.id)) powerSaveBlocker.stop(this.id)
      this.id = null
    }
  }
}
