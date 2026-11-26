import { useEffect, useRef, useState } from 'react'
import { CONNECTOR_TEST_MS } from '../../../shared/connectors.ts'
import { api } from '../api'
import { report } from '../notice'

/** past main's own deadline: only a lost IPC answer gets here */
const GUARD_MS = CONNECTOR_TEST_MS + 15_000

export interface ConnectorTest {
  testing: boolean
  /** seconds since "Testar" was pressed, while testing */
  elapsed: number
  /** tools counted by the last test that answered */
  found?: number
  run: () => void
}

/**
 * "Testar" for one connector. It always ends: main fails the stage that did not answer by
 * CONNECTOR_TEST_MS (shown as the row's erro), and this guard stops the spinner if no answer arrives at all.
 */
export function useConnectorTest(id: string): ConnectorTest {
  const [testing, setTesting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [found, setFound] = useState<number | undefined>()
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    if (!testing) return
    const started = Date.now()
    setElapsed(0)
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(tick)
  }, [testing])

  const run = () => {
    if (testing) return
    setTesting(true)
    setFound(undefined)
    let guard: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<never>((_, reject) => {
      guard = setTimeout(() => reject(new Error(`O teste não respondeu em ${Math.round(GUARD_MS / 1000)} s. Veja os logs (ícone de arquivo em Conectores).`)), GUARD_MS)
    })
    void Promise.race([api.connectors.test({ id }), late])
      .then((r) => { if (alive.current) setFound(r.tools) })
      // a stage failure is already on the row as erro; report() shows the rest (and this one too)
      .catch(report)
      .finally(() => {
        clearTimeout(guard)
        if (alive.current) setTesting(false)
      })
  }

  return { testing, elapsed, found, run }
}
