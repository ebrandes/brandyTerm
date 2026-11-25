import { useEffect } from 'react'

const markSeen = (projectId: string) => void window.brandy.setSettings({ lastSeen: { [projectId]: new Date().toISOString() } })

/**
 * Records when the user had a project open, for the sidebar "novidades":
 * on opening it and again on leaving it, so what ended while it was open
 * does not show up as new afterwards.
 */
export function useLastSeen(projectId: string | undefined): void {
  useEffect(() => {
    if (!projectId) return
    markSeen(projectId)
    return () => markSeen(projectId)
  }, [projectId])
}
