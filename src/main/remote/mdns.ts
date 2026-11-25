import { Bonjour } from 'bonjour-service'
import type { HostDeps } from './server.ts'

/** Announces the host on the LAN as `_brandyterm._tcp`. */
export const publishMdns: NonNullable<HostDeps['publish']> = info => {
  const bonjour = new Bonjour()
  const svc = bonjour.publish({ name: info.name, type: 'brandyterm', port: info.port, txt: info.txt })
  return {
    stop() {
      svc.stop?.()
      bonjour.destroy()
    }
  }
}
