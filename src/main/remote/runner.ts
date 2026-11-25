// Keeps one host server running on the wanted port (null: none) and says how it went. No Electron.
import type { RemoteStatus } from '../../shared/remote/status.ts'

export interface Startable {
  start(port: number): Promise<void>
  stop(): Promise<void>
}

export interface RunnerDeps<S extends Startable> {
  /** the port the settings ask for, or null when remote access is off */
  desired(): number | null
  make(): S
  onStatus?: (s: RemoteStatus) => void
}

export interface Runner<S> {
  /** brings the server in line with desired(); calls run one after another */
  sync(): Promise<void>
  server(): S | null
  status(): RemoteStatus
  stop(): Promise<void>
}

export function hostRunner<S extends Startable>(deps: RunnerDeps<S>): Runner<S> {
  let server: S | null = null
  let port = 0
  let applying: Promise<void> = Promise.resolve()
  let closed = false
  let status: RemoteStatus = { state: 'off' }

  const set = (s: RemoteStatus): void => {
    if (JSON.stringify(s) === JSON.stringify(status)) return
    status = s
    deps.onStatus?.(s)
  }
  const failedPort = (): number | null => (status.state === 'failed' ? status.port : null)

  const apply = async (): Promise<void> => {
    const want = closed ? null : deps.desired()
    if (server && want === port) return
    if (!server && want !== null && want === failedPort()) return // already failed on this port: retry only after a change
    if (server) {
      const old = server
      server = null
      await old.stop()
    }
    if (want === null) return set({ state: 'off' })
    const next = deps.make()
    try {
      await next.start(want)
      server = next
      port = want
      set({ state: 'on', port: want })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.error('[remote] não foi possível iniciar o servidor:', error)
      set({ state: 'failed', port: want, error })
      await next.stop()
    }
  }

  const sync = (): Promise<void> => (applying = applying.then(apply, apply))

  return {
    sync,
    server: () => server,
    status: () => status,
    async stop() {
      closed = true
      await sync()
    }
  }
}
