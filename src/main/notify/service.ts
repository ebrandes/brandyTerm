// What happens to an event: shown or not, and where a click leads. Pure (no electron import).
import type { NotifyTarget } from '../../shared/api.ts'
import type { Project } from '../../shared/types.ts'
import { createTracker, notificationText, type NotifyEvent } from './rules.ts'

export interface NotifyDeps {
  enabled(): boolean
  /** the app window is on screen and has the keyboard */
  focused(): boolean
  show(text: { title: string; body: string }, onClick: () => void): void
  /** brings the window up and tells the renderer there is a target to take */
  open(): void
}

export function createNotifications(deps: NotifyDeps) {
  const trackers = new Map<string, ReturnType<typeof createTracker>>()
  let view: NotifyTarget | null = null
  let target: NotifyTarget | null = null

  const watching = (e: NotifyEvent): boolean =>
    deps.focused() && view?.projectId === e.projectId && view.threadId === e.threadId

  return {
    /** `source`: this machine or a paired one; `idOf`: the project id as the renderer knows it */
    observe(source: string, projects: Project[], idOf: (id: string) => string = (id) => id): void {
      let tracker = trackers.get(source)
      if (!tracker) trackers.set(source, (tracker = createTracker()))
      // tracked even when switched off, so turning it on does not replay the past
      for (const found of tracker.observe(projects)) {
        const e = { ...found, projectId: idOf(found.projectId) }
        if (!deps.enabled() || watching(e)) continue
        deps.show(notificationText(e), () => {
          target = { projectId: e.projectId, threadId: e.threadId }
          deps.open()
        })
      }
    },
    /** what the renderer is showing; null when something covers the chat */
    setView(next: NotifyTarget | null): void {
      view = next
    },
    /** the clicked notification's destination, handed out once (also to a window created by the click) */
    takeTarget(): NotifyTarget | null {
      const out = target
      target = null
      return out
    }
  }
}
