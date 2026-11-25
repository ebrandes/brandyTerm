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
