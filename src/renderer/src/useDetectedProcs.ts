import { useEffect, useState } from 'react'
import type { DetectedProc } from '../../shared/proc-attribution.ts'
import { api } from './api'

const EVERY_MS = 5_000

/** Polls what runs for the project, only while the window is visible: a hidden app scans nothing. */
export function useDetectedProcs(projectId: string): DetectedProc[] {
  const [found, setFound] = useState<{ id: string; list: DetectedProc[] }>({ id: projectId, list: [] })

  useEffect(() => {
    let stopped = false
    let busy = false
    const read = async () => {
      if (busy || document.visibilityState !== 'visible') return
      busy = true
      try {
        const list = await api.detectedProcesses(projectId)
        // same answer: keep the old object, so nothing re-renders
        if (!stopped) setFound((old) => (old.id === projectId && JSON.stringify(old.list) === JSON.stringify(list) ? old : { id: projectId, list }))
      } catch {
        // best effort: the next tick tries again
      } finally {
        busy = false
      }
    }
    void read()
    const timer = setInterval(() => void read(), EVERY_MS)
    const onVisible = () => void read()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [projectId])

  // never show the previous project's list while the new one loads
  return found.id === projectId ? found.list : []
}
