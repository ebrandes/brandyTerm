// Why a saved connector cannot run as it is, in pt-BR, or null. Shared by main (status, which threads see it) and
// the panel. Pure. A connector with a problem still shows in the panel, with Corrigir and Remover.
import type { Connector } from './connectors.ts'
import { validateCustom } from './custom-form.ts'
import { fixPastedCommand, installHint } from './install-command.ts'

type Saved = Pick<Connector, 'name' | 'transport' | 'command' | 'args' | 'url' | 'preset' | 'broken'>

export function connectorProblem(c: Saved): string | null {
  if (c.broken) return c.broken
  if (c.preset) return null
  if (c.transport !== 'stdio' && c.transport !== 'http') return 'Tipo de conexão desconhecido: escolha comando (stdio) ou URL (http)'
  const invalid = validateCustom({ name: c.name, transport: c.transport, command: c.command ?? '', url: c.url ?? '' })
  if (invalid) return invalid
  if (c.transport !== 'stdio') return null
  const fix = fixPastedCommand(c.command ?? '', c.args ?? [])
  // a pasted install command the startup repair could not turn into the server it installs
  return fix?.kind === 'install' ? installHint(fix) : null
}
