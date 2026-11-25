// Pure: the default of the `remote` app setting, shared by main and renderer.
import type { AppSettings } from '../types.ts'

export type RemoteSettings = NonNullable<AppSettings['remote']>

export const DEFAULT_REMOTE: RemoteSettings = { enabled: false, port: 47321 }
