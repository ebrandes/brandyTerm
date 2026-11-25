// Import from Claude Code. Local only (deny): the renderer sees key names, and main re-reads the file for the values.
import { ruleOf } from '../rpc/channels.ts'
import { registry, type Registry } from '../rpc/registry.ts'
import { validateCustom } from '../../shared/custom-form.ts'
import type { Connector, ConnectorSecrets } from '../../shared/connectors.ts'
import type { ConnectorStore } from './store.ts'
import type { SecretStore } from './secrets.ts'
import { CLAUDE_CONFIG, readClaudeServers, readRawServers, toDraft } from './import-claude.ts'

const TRUST = 'Confirme "Confio neste comando" antes de salvar'

export function registerImportIpc(
  { store, secrets }: { store: ConnectorStore; secrets: SecretStore },
  reg: Registry = registry,
  file: string = CLAUDE_CONFIG()
): void {
  reg.add('connectors:import-list', () => readClaudeServers(file), ruleOf('connectors:import-list'))

  reg.add('connectors:import', (a: { names: string[]; trusted: boolean }) => {
    const names = new Set(Array.isArray(a?.names) ? a.names.filter((n): n is string => typeof n === 'string') : [])
    const raw = readRawServers(file)
    const ready: { draft: Omit<Connector, 'id' | 'alwaysAllow'>; secrets: ConnectorSecrets }[] = []
    for (const c of readClaudeServers(file)) {
      if (!names.has(c.name) || c.unsupported) continue
      if (c.transport === 'stdio' && a.trusted !== true) throw new Error(TRUST)
      const made = toDraft(c, raw[c.name])
      const problem = validateCustom({ name: made.draft.name, transport: made.draft.transport, command: made.draft.command ?? '', url: made.draft.url ?? '' })
      if (problem) throw new Error(`${c.name}: ${problem}`)
      ready.push(c.transport === 'stdio' ? { ...made, draft: { ...made.draft, trusted: true } } : made)
    }
    // all checked before anything is saved
    const added: string[] = []
    try {
      for (const { draft, secrets: s } of ready) {
        const c = store.add(draft)
        added.push(c.id)
        if (s.env || s.headers) secrets.set(c.id, s)
      }
    } catch (e) {
      for (const id of added) {
        secrets.remove(id)
        store.remove(id)
      }
      throw e
    }
    return { imported: ready.map((r) => r.draft.name) }
  }, ruleOf('connectors:import'))
}
