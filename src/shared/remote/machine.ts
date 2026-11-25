export type MachineOs = 'mac' | 'windows' | 'linux'

export interface MachineInfo {
  id: string
  name: string
  os: MachineOs
}

export function osOf(platform: string): MachineOs {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'windows'
  return 'linux'
}

const FALLBACK: Record<MachineOs, string> = { mac: 'Mac', windows: 'PC Windows', linux: 'PC Linux' }

export function defaultName(hostname: string, os: MachineOs): string {
  const name = hostname.trim().replace(/\.local$/i, '')
  return name || FALLBACK[os]
}

export interface TrustedDevice {
  pub: string
  machineId: string
  name: string
  os: MachineOs | 'phone'
  addedAt: string
  lastSeen?: string
  terminal: boolean
}

/** A paired machine this one dials, as the renderer sees it. */
export interface RemoteHostInfo {
  machine: MachineInfo
  online: boolean
  /** offline since, ISO */
  since?: string
  address?: string
  error?: string
}

/** A host seen by mDNS that is not paired yet. */
export interface DiscoveredHost {
  name: string
  os: MachineOs
  address: string
  machineId: string
}
