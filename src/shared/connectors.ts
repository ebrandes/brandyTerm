// Connector types shared by main, preload and renderer. Secret values never appear here except ConnectorSecrets (main only).

export interface TokenField {
  key: string
  label: string
  /** `format` contains "{value}" */
  use: { header: string; format: string } | { env: string }
}

export type ConnectorAuth =
  | { kind: 'none' }
  | { kind: 'oauth' }
  | { kind: 'token'; fields: TokenField[] }
  | { kind: 'cli'; command: string[]; check?: string[] }

export interface Connector {
  id: string
  name: string
  description: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  /** names only; values are secrets */
  envKeys?: string[]
  headerKeys?: string[]
  auth: ConnectorAuth
  enabled: boolean
  preset?: string
  projects?: string[]
  /** tool names */
  alwaysAllow: string[]
  /** "Confio neste comando" given (custom/imported stdio) */
  trusted?: boolean
}

export type ConnectorStatus = 'desconectado' | 'conectado' | 'precisa de login' | 'erro'

export interface ConnectorView extends Omit<Connector, 'auth'> {
  authKind: ConnectorAuth['kind']
  status: ConnectorStatus
  error?: string
  toolCount?: number
}

export interface PanelLogin {
  connectorId: string
  name: string
  phase: 'ask' | 'waiting' | 'failed'
  error?: string
  authKind: ConnectorAuth['kind']
  /** started from the panel (a row's Entrar or a fresh install); false when only a thread waits on it */
  panel: boolean
  fields?: { key: string; label: string }[]
  terminalId?: string
}

export type ThreadLogin = PanelLogin

export interface ConnectorsState {
  list: ConnectorView[]
  logins: PanelLogin[]
}

export interface Preset {
  id: string
  name: string
  description: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  auth: ConnectorAuth
}

export interface ConnectorSecrets {
  env?: Record<string, string>
  headers?: Record<string, string>
  oauth?: { tokens?: unknown; client?: unknown; verifier?: string }
}

export interface ThreadRef {
  projectId: string
  threadId: string
}

/** A server found in another tool's config, offered for import. Values are never carried here. */
export interface ImportCandidate {
  name: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  envKeys?: string[]
  headerKeys?: string[]
  source: string
  /** why it cannot be imported (pt-BR) */
  unsupported?: string
}

/** The subset of a host's connectors that crosses the remote filter. */
export type RemoteConnectorView = Pick<ConnectorView, 'id' | 'name' | 'description' | 'status' | 'enabled' | 'preset' | 'toolCount'>

/** What the panel sends to add a connector. With a preset, main takes everything but these user fields from the preset. */
export type ConnectorDraft = Partial<Omit<Connector, 'id' | 'alwaysAllow' | 'auth'>> & { name: string; auth?: ConnectorAuth }

/** The only fields the panel may change on a saved connector. */
export type ConnectorPatch = Partial<Pick<Connector, 'name' | 'description' | 'projects' | 'enabled'>>
