import { osOf, type MachineOs } from './remote/machine.ts'

/**
 * Platform-dependent bits of the sidebar's project menu, kept pure so node --test covers them.
 * `platform` is process.platform of this machine, exposed to the renderer by the preload.
 */

/** the "show the folder" item, named after the platform's file manager */
export function revealLabel(platform: string | undefined): string {
  if (platform === 'darwin') return 'Abrir no Finder'
  if (platform === 'win32') return 'Abrir no Explorador de Arquivos'
  return 'Abrir pasta'
}

/** the OS of the machine that holds the folder: the remote machine's, or this one's */
export function folderOs(machine: { os: MachineOs; remote: boolean } | undefined, platform: string): MachineOs {
  return machine?.remote ? machine.os : osOf(platform)
}

/** the path as that OS writes it: backslashes on Windows (a stored C:/x/y becomes C:\x\y), untouched elsewhere */
export function copyablePath(path: string, os: MachineOs): string {
  return os === 'windows' ? path.replace(/\//g, '\\') : path
}
