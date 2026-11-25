// What the host server is doing, for the "Acesso remoto" panel. Pure.

export type RemoteStatus =
  | { state: 'off' }
  | { state: 'on'; port: number }
  /** the port could not be opened (in use, no permission); retried only after the settings change */
  | { state: 'failed'; port: number; error: string }

export const portFailed = (port: number): string => `Não foi possível abrir a porta ${port}`

/** The failure in the user's words: the usual causes named, anything else left out (it is in the log). */
export function failedText(port: number, error: string): string {
  if (/EADDRINUSE/.test(error)) return `${portFailed(port)}: outro programa já usa essa porta.`
  if (/EACCES|EPERM/.test(error)) return `${portFailed(port)}: sem permissão para usar essa porta.`
  return `${portFailed(port)}.`
}
