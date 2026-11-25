// Reads MCP servers from Claude Code's user config (~/.claude.json, top-level mcpServers). Read only: nothing under ~/.claude is ever written.
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import type { Connector, ConnectorSecrets, ImportCandidate } from '../../shared/connectors.ts'

export type { ImportCandidate }

export const CLAUDE_CONFIG = (): string => join(os.homedir(), '.claude.json')

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v)
const keysOf = (v: unknown): string[] => (isObj(v) ? Object.keys(v) : [])
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const strRec = (v: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(isObj(v) ? v : {}).filter((e): e is [string, string] => typeof e[1] === 'string'))

function candidate(name: string, raw: unknown): ImportCandidate {
  const base = { name, envKeys: keysOf(isObj(raw) ? raw.env : undefined), headerKeys: keysOf(isObj(raw) ? raw.headers : undefined), source: '~/.claude.json' }
  if (!isObj(raw)) return { ...base, transport: 'stdio', unsupported: 'Formato não reconhecido' }
  if (raw.type === 'sse') return { ...base, transport: 'http', url: typeof raw.url === 'string' ? raw.url : undefined, unsupported: 'SSE não é suportado' }
  if (raw.type === 'http' || (raw.type === undefined && typeof raw.url === 'string' && typeof raw.command !== 'string')) {
    return typeof raw.url === 'string' ? { ...base, transport: 'http', url: raw.url } : { ...base, transport: 'http', unsupported: 'Sem URL' }
  }
  if (typeof raw.command === 'string' && (raw.type === undefined || raw.type === 'stdio')) {
    return { ...base, transport: 'stdio', command: raw.command, args: strList(raw.args) }
  }
  return { ...base, transport: 'stdio', unsupported: 'Formato não reconhecido' }
}

/** The raw `mcpServers` of the file, or {} when it is missing or unreadable. Values stay in main. */
export function readRawServers(file: string = CLAUDE_CONFIG()): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    return isObj(v) && isObj(v.mcpServers) ? v.mcpServers : {}
  } catch {
    return {}
  }
}

/** Candidates carry key names only, never env or header values. */
export function readClaudeServers(file: string = CLAUDE_CONFIG()): ImportCandidate[] {
  return Object.entries(readRawServers(file)).map(([name, raw]) => candidate(name, raw))
}

/** A BrandyTerm connector from a candidate and its raw entry. Values go to `secrets`; the draft keeps names only. */
export function toDraft(c: ImportCandidate, raw: unknown): { draft: Omit<Connector, 'id' | 'alwaysAllow'>; secrets: ConnectorSecrets } {
  const r = isObj(raw) ? raw : {}
  const env = strRec(r.env)
  const headers = strRec(r.headers)
  const base = { name: c.name, description: 'Importado do Claude Code', enabled: true }
  const secrets: ConnectorSecrets = {
    ...(Object.keys(env).length ? { env } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
  }
  if (c.transport === 'stdio') {
    const envKeys = Object.keys(env)
    return { draft: { ...base, transport: 'stdio', command: c.command, args: c.args ?? [], ...(envKeys.length ? { envKeys } : {}), auth: { kind: 'none' } }, secrets }
  }
  const headerKeys = Object.keys(headers)
  return { draft: { ...base, transport: 'http', url: c.url, ...(headerKeys.length ? { headerKeys } : {}), auth: headerKeys.length ? { kind: 'none' } : { kind: 'oauth' } }, secrets }
}
