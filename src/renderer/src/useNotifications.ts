import { useEffect, useRef } from 'react'
import type { NotifyTarget } from '../../shared/api'
import { api } from './api'

/** Tells main what is in sight (null: covered) and goes where a clicked notification leads. */
export function useNotifications(view: NotifyTarget | null, goTo: (target: NotifyTarget) => void): void {
  const projectId = view?.projectId
  const threadId = view?.threadId
  useEffect(() => {
    void api.notify.setView(projectId ? { projectId, threadId } : null)
  }, [projectId, threadId])

  const go = useRef(goTo)
  go.current = goTo
  useEffect(() => {
    // also on mount: a window created by the click has no one to ping yet
    const take = () => void api.notify.takeTarget().then((t) => t && go.current(t))
    const off = api.notify.onOpen(take)
    take()
    return off
  }, [])
}
