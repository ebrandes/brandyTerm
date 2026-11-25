// "Aparelhos pareados": both directions, each removed by its key and role. No Electron (client-ipc.ts wires it).
import type { TrustedDevice } from '../../shared/remote/machine.ts'
import type { TrustStore } from './trust.ts'

export function deviceCalls(trust: TrustStore) {
  return {
    /** the devices that control this machine (client) and the machines this one controls (host) */
    devices: (): TrustedDevice[] => trust.list(),
    /** Removing a host stops dialing it and drops its projects: RemoteHosts follows the trust store. */
    revoke(arg: unknown): void {
      const { pub, role } = (typeof arg === 'object' && arg !== null ? arg : {}) as { pub?: unknown; role?: unknown }
      if (typeof pub !== 'string' || (role !== 'client' && role !== 'host')) throw new Error('Aparelho inválido')
      trust.revoke(pub, role)
    }
  }
}
