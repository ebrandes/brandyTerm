// Pure (no Electron): merging a partial `remote` settings patch.
import type { AppSettings } from '../../shared/types.ts'

export type RemoteSettings = NonNullable<AppSettings['remote']>

export const DEFAULT_REMOTE: RemoteSettings = { enabled: false, port: 47321 }

const validPort = (p: unknown): p is number => typeof p === 'number' && Number.isInteger(p) && p >= 1024 && p <= 65535

/** Fields missing from the patch keep their current value; an invalid port keeps the current one. */
export function mergeRemote(prev: Partial<RemoteSettings> | undefined, patch: Partial<RemoteSettings>): RemoteSettings {
  const base = { ...DEFAULT_REMOTE, ...prev }
  return {
    enabled: 'enabled' in patch ? !!patch.enabled : base.enabled,
    port: validPort(patch.port) ? patch.port : validPort(base.port) ? base.port : DEFAULT_REMOTE.port
  }
}
