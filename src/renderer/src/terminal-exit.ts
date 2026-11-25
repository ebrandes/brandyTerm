// The line a terminal prints when its process ends. A connector login terminal does not restart on Enter, so it gets no hint.

export function exitNotice(id: string, code: number): string {
  const hint = id.startsWith('connector-') ? '' : '. Pressione Enter para abrir outro shell'
  return `\r\n\x1b[2m[processo encerrado (${code})${hint}]\x1b[0m\r\n`
}
