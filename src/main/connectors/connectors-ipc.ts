// The panel's channels. Local only: every one is `deny` for a paired machine.
import type { Connector, ConnectorAuth, ConnectorDraft, ConnectorPatch, ConnectorSecrets } from '../../shared/connectors.ts'
import { ruleOf } from '../rpc/channels.ts'
import { registry, type Registry } from '../rpc/registry.ts'
import type { ConnectorStore } from './store.ts'
import type { SecretStore } from './secrets.ts'
import { PRESETS, presetById } from './presets.ts'

export interface ConnectorsIpcDeps {
  store: ConnectorStore
  secrets: SecretStore
  hub: { close(id: string): Promise<void>; test(c: Connector): Promise<number> }
  login: { ask(c: Connector): void; enter(id: string, values?: Record<string, string>): Promise<void>; cancel(id: string): void }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined)

/** the secret values the client sent, empty ones dropped */
function clean(rec: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(rec ?? {})) if (k.trim() && typeof v === 'string' && v !== '') out[k.trim()] = v
  return out
}

const union = (a: string[] | undefined, b: string[]): string[] | undefined => {
  const all = [...new Set([...(a ?? []), ...b])]
  return all.length ? all : undefined
}

/** a custom connector logs in by OAuth (remote only) or not at all: a client-sent `cli` command would run unreviewed */
function customAuth(d: ConnectorDraft): ConnectorAuth {
  return d.transport === 'http' && d.auth?.kind === 'oauth' ? { kind: 'oauth' } : { kind: 'none' }
}

function build(a: { preset?: string; draft?: ConnectorDraft }, keys: { env: string[]; headers: string[] }): Omit<Connector, 'id' | 'alwaysAllow'> {
  const d = a.draft
  if (!d || typeof d !== 'object') throw new Error('Conector inválido')
  const user = { enabled: d.enabled !== false, ...(strList(d.projects)?.length ? { projects: strList(d.projects) } : {}) }
  if (a.preset !== undefined) {
    const p = presetById(str(a.preset))
    if (!p) throw new Error('Preset desconhecido')
    const { id, ...base } = p
    return { ...base, preset: id, ...user }
  }
  const name = str(d.name).trim()
  if (!name) throw new Error('Informe o nome')
  const transport = d.transport === 'http' ? 'http' : 'stdio'
  const envKeys = union(strList(d.envKeys), keys.env)
  const headerKeys = union(strList(d.headerKeys), keys.headers)
  const common = { name, description: str(d.description), ...user, ...(envKeys ? { envKeys } : {}), ...(headerKeys ? { headerKeys } : {}) }
  if (transport === 'stdio') {
    if (!str(d.command).trim()) throw new Error('Informe o comando')
    if (d.trusted !== true) throw new Error('Confirme "Confio neste comando" antes de salvar')
    return { ...common, transport, command: str(d.command).trim(), args: strList(d.args) ?? [], auth: { kind: 'none' }, trusted: true }
  }
  if (!str(d.url).trim()) throw new Error('Informe a URL')
  return { ...common, transport, url: str(d.url).trim(), auth: customAuth(d) }
}

export function registerConnectorsIpc({ store, secrets, hub, login }: ConnectorsIpcDeps, reg: Registry = registry): void {
  const need = (id: unknown): Connector => {
    const c = store.get(str(id))
    if (!c) throw new Error('Conector não encontrado')
    return c
  }

  reg.add('connectors:presets', () => PRESETS, ruleOf('connectors:presets'))

  reg.add('connectors:add', (a: { preset?: string; draft: ConnectorDraft; secrets?: ConnectorSecrets }) => {
    const env = clean(a.secrets?.env)
    const headers = clean(a.secrets?.headers)
    const made = store.add(build(a, { env: Object.keys(env), headers: Object.keys(headers) }))
    if (Object.keys(env).length || Object.keys(headers).length) {
      try {
        secrets.set(made.id, { ...(Object.keys(env).length ? { env } : {}), ...(Object.keys(headers).length ? { headers } : {}) })
      } catch (e) {
        store.remove(made.id)
        throw e
      }
    }
    return { id: made.id }
  }, ruleOf('connectors:add'))

  reg.add('connectors:update', async (a: { id: string; patch: ConnectorPatch; secrets?: ConnectorSecrets }) => {
    const c = need(a.id)
    const p = a.patch ?? {}
    const patch: Partial<Connector> = {}
    if (p.name !== undefined) {
      if (!str(p.name).trim()) throw new Error('Informe o nome')
      patch.name = str(p.name).trim()
    }
    if (p.description !== undefined) patch.description = str(p.description)
    if (p.enabled !== undefined) patch.enabled = p.enabled === true
    if ('projects' in p) patch.projects = strList(p.projects)?.length ? strList(p.projects) : undefined
    const env = clean(a.secrets?.env)
    const headers = clean(a.secrets?.headers)
    const changed = Object.keys(env).length > 0 || Object.keys(headers).length > 0
    if (changed) {
      const prev = secrets.get(c.id)
      secrets.patch(c.id, { env: { ...prev.env, ...env }, headers: { ...prev.headers, ...headers } })
      patch.envKeys = union(c.envKeys, Object.keys(env))
      patch.headerKeys = union(c.headerKeys, Object.keys(headers))
    }
    store.update(c.id, patch)
    if (changed || patch.enabled === false) await hub.close(c.id) // the next call starts with the new values
  }, ruleOf('connectors:update'))

  reg.add('connectors:remove', async (a: { id: string }) => {
    const c = need(a.id)
    login.cancel(c.id)
    await hub.close(c.id)
    secrets.remove(c.id)
    store.remove(c.id)
  }, ruleOf('connectors:remove'))

  reg.add('connectors:enable', async (a: { id: string; on: boolean }) => {
    const c = need(a.id)
    store.update(c.id, { enabled: a.on === true })
    if (a.on !== true) await hub.close(c.id)
  }, ruleOf('connectors:enable'))

  reg.add('connectors:test', async (a: { id: string }) => ({ tools: await hub.test(need(a.id)) }), ruleOf('connectors:test'))

  reg.add('connectors:login', async (a: { id: string; values?: Record<string, string> }) => {
    const c = need(a.id)
    login.ask(c)
    // no values: only the card opens (right after adding); values, even {}: the user pressed Entrar
    if (a.values && typeof a.values === 'object') await login.enter(c.id, a.values)
  }, ruleOf('connectors:login'))

  reg.add('connectors:login-cancel', (a: { id: string }) => login.cancel(str(a.id)), ruleOf('connectors:login-cancel'))

  reg.add('connectors:revoke-always', (a: { id: string; tool: string }) => store.revoke(need(a.id).id, str(a.tool)), ruleOf('connectors:revoke-always'))
}
