// A custom connector whose command was pasted in the wrong shape becomes what was meant: on save, and once at
// startup for those saved before. `claude mcp add --transport http x <url>` as a stdio command never answers
// initialize (the Context7 timeout); it is the URL connector.
import type { Connector, ConnectorDraft, ConnectorSecrets } from '../../shared/connectors.ts'
import { fixPastedCommand, type PastedFix } from '../../shared/install-command.ts'
import { diagLog } from '../diag-log.ts'
import type { ConnectorStore } from './store.ts'
import type { SecretStore } from './secrets.ts'

const pasted = (c: { transport?: string; command?: string; args?: string[] }): PastedFix | null =>
  c.transport === 'http' || typeof c.command !== 'string' ? null : fixPastedCommand(c.command, Array.isArray(c.args) ? c.args : [])

const merge = (a: Record<string, string> | undefined, b: Record<string, string>): Record<string, string> => ({ ...b, ...a })

/** the draft as it should be saved, the pasted header and env values moved to the secrets */
export function normalizeDraft(draft: ConnectorDraft, secrets: ConnectorSecrets = {}): { draft: ConnectorDraft; secrets: ConnectorSecrets } {
  const fix = draft && typeof draft === 'object' ? pasted(draft) : null
  if (!fix) return { draft, secrets }
  const { fixed } = fix
  const next: ConnectorDraft = fixed.transport === 'http'
    ? { ...draft, transport: 'http', url: fixed.url, command: undefined, args: undefined }
    : { ...draft, command: fixed.command, args: fixed.args }
  diagLog('mcp', 'info', 'comando colado corrigido ao salvar', { connector: draft.name, kind: fix.kind, tool: fix.tool, transport: fixed.transport })
  return { draft: next, secrets: { ...secrets, env: merge(secrets.env, fixed.env), headers: merge(secrets.headers, fixed.headers) } }
}

/** Rewrites saved connectors in the wrong shape. A failure leaves the connector as it was. */
export function repairPasted(store: ConnectorStore, secrets: SecretStore): number {
  let n = 0
  for (const c of store.list()) {
    const fix = c.preset ? null : pasted(c)
    if (!fix) continue
    try {
      const { fixed } = fix
      const env = Object.keys(fixed.env)
      const headers = Object.keys(fixed.headers)
      if (env.length || headers.length) {
        const prev = secrets.get(c.id)
        secrets.patch(c.id, { env: merge(prev.env, fixed.env), headers: merge(prev.headers, fixed.headers) })
      }
      const keys = {
        ...(env.length || c.envKeys ? { envKeys: [...new Set([...(c.envKeys ?? []), ...env])] } : {}),
        ...(headers.length || c.headerKeys ? { headerKeys: [...new Set([...(c.headerKeys ?? []), ...headers])] } : {}),
      }
      const patch: Partial<Connector> = fixed.transport === 'http'
        ? { transport: 'http', url: fixed.url, command: undefined, args: undefined, trusted: undefined, auth: { kind: 'none' }, ...keys }
        : { command: fixed.command, args: fixed.args, ...keys }
      store.update(c.id, patch)
      n++
      diagLog('mcp', 'info', 'conector salvo com comando colado foi corrigido', { connector: c.name, id: c.id, kind: fix.kind, tool: fix.tool, transport: fixed.transport })
    } catch (e) {
      diagLog('mcp', 'warn', 'não foi possível corrigir o conector', { connector: c.name, id: c.id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return n
}
