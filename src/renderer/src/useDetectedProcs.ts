import { useCallback, useEffect, useRef, useState } from 'react'
import type { DetectedProc } from '../../shared/proc-attribution.ts'
import { api } from './api'

const EVERY_MS = 5_000

/** Polls what runs for the project, only while the window is visible: a hidden app scans nothing. */
export function useDetectedProcs(projectId: string): { list: DetectedProc[]; refresh: () => void } {
  const readNow = useRef<(force: boolean) => void>(() => {})
  const [found, setFound] = useState<{ id: string; list: DetectedProc[] }>({ id: projectId, list: [] })

  useEffect(() => {
    let stopped = false
    let busy = false
    let latest = 0
    const read = async (force = false) => {
      if ((busy && !force) || document.visibilityState !== 'visible') return
      busy = true
      const turn = ++latest
      try {
        const list = await api.detectedProcesses(projectId)
        // same answer: keep the old object, so nothing re-renders
        // a forced read may overtake a poll: the older answer is dropped
        if (!stopped && turn === latest) setFound((old) => (old.id === projectId && JSON.stringify(old.list) === JSON.stringify(list) ? old : { id: projectId, list }))
      } catch {
        // best effort: the next tick tries again
      } finally {
        busy = false
      }
    }
    readNow.current = (force) => void read(force)
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
  const refresh = useCallback(() => readNow.current(true), [])
  return { list: found.id === projectId ? found.list : [], refresh }
}
