import { useEffect, useRef, useState } from 'react'
import type { DetectedProc } from '../../shared/proc-attribution.ts'
import { api } from './api'

/** how long "parado ✓" stays on screen */
const DONE_MS = 3_000

export interface Stop {
  phase: 'confirm' | 'stopping' | 'stopped' | 'error'
  /** as it was when asked: the card outlives its place in the list */
  proc: DetectedProc
  error?: string
}

/** The state of each stop, and the cards to show: the list plus the ones whose outcome is still on screen. */
export function useStopDetected(projectId: string, detected: DetectedProc[], refresh: () => void) {
  const [stops, setStops] = useState(new Map<number, Stop>())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const set = (pid: number, stop: Stop | undefined) =>
    setStops((old) => {
      const next = new Map(old)
      if (stop) next.set(pid, stop)
      else next.delete(pid)
      return next
    })

  const confirm = async (proc: DetectedProc) => {
    set(proc.pid, { phase: 'stopping', proc })
    const result = await api.stopDetected({ projectId, pid: proc.pid })
      .catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }))
    if (result.ok) {
      set(proc.pid, { phase: 'stopped', proc })
      timers.current.add(setTimeout(() => set(proc.pid, undefined), DONE_MS))
    } else set(proc.pid, { phase: 'error', proc, error: result.error })
    refresh()
  }

  const listed = new Set(detected.map((d) => d.pid))
  // a confirmation about a process that left the list has nothing to ask
  const kept = [...stops.values()].filter((s) => s.phase !== 'confirm' && !listed.has(s.proc.pid))
  const rows = [
    ...detected.map((proc) => ({ proc, stop: stops.get(proc.pid), gone: false })),
    ...kept.map((stop) => ({ proc: stop.proc, stop, gone: true }))
  ].sort((a, b) => a.proc.pid - b.proc.pid)

  return {
    rows,
    confirm,
    ask: (proc: DetectedProc) => set(proc.pid, { phase: 'confirm', proc }),
    cancel: (pid: number) => set(pid, undefined)
  }
}
