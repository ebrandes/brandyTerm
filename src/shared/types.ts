import type { MachineInfo, MachineOs } from './remote/machine.ts'
import type { ConnectorsState, ThreadLogin } from './connectors.ts'
export type AgentId = 'claude' | 'codex' | 'antigravity'
export type ThreadState = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'interrupted' | 'cancelled'
export type Effort = 'low' | 'medium' | 'high'

export const AGENT_NAMES: Record<AgentId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  antigravity: 'Antigravity'
}

export const EFFORT_LABEL: Record<Effort, string> = {
  low: 'Esforço baixo',
  medium: 'Esforço médio',
  high: 'Esforço alto'
}

export interface Usage {
  input: number
  output: number
  cached: number
  costUsd?: number
  /** measured = reported by the CLI; unknown = CLI gave nothing */
  measured: boolean
}

export interface Summary {
  agent: AgentId
  title: string
  text: string
  threadId?: string
}

/** A file the user pasted, dropped or picked; stored under the app's data folder. */
export interface Attachment {
  id: string
  name: string
  /** image and pdf go to the model as content blocks; text is inlined; file is referenced by path */
  kind: 'image' | 'pdf' | 'text' | 'file'
  mime: string
  size: number
  path: string
  /** the user drew marks on the image before sending */
  marked?: boolean
}

/** Something the composer offers after "/": an app command, a plugin skill/command or a project command. */
export interface SlashCommand {
  name: string
  description: string
  source: 'app' | 'plugin' | 'project'
  /** a skill (model-invoked through the Skill tool), not just a user command */
  skill?: boolean
}

/** A file or folder offered after "@" in the composer. */
export interface FsEntry {
  /** the text inserted after "@": relative to the project root, or as typed for "~/" and "/" paths; folders end with '/' */
  path: string
  kind: 'file' | 'dir'
}

export interface Message {
  id: string
  author: 'user' | 'coordinator' | 'agent' | 'system'
  time: string
  text: string
  summaries?: Summary[]
  isError?: boolean
  attachments?: Attachment[]
  /** threads the coordinator opened with this message (shown as clickable chips) */
  threads?: string[]
  /** a thread is asking the user something; answer routes back to that thread */
  ask?: { threadId: string; question: string; options?: string[]; recommended?: boolean }
}

export interface Todo {
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

export type ApprovalDecision = 'allow' | 'deny' | 'always' | 'all' | 'forever'

export interface ContextUse {
  used: number
  limit: number
}

/** A tool call the thread wants to make and the user must approve (Bash that changes things, edits, web). */
export interface ToolApproval {
  id: string
  tool: string
  summary: string
  /** command, file and diff preview, truncated */
  detail?: string
  /** label of the "always" button: what it will allow from now on */
  always?: string
  /** a connector call: the card shows the connector's name; "permitir tudo" does not cover it */
  connector?: { name: string; tool: string }
  createdAt: string
}

/** a file a thread created or edited; `path` is relative to the project root */
export interface ThreadFile {
  path: string
  op: 'write' | 'edit'
  at: string
}

export type ArtifactKind = 'md' | 'mermaid' | 'html' | 'svg' | 'code'
export type MediaKind = 'video' | 'image'

/** an artifact read for the viewer; a file outside the project or gone reads as missing */
export type ArtifactContent =
  | { kind: 'missing' }
  | { kind: 'too-big'; size: number }
  | { kind: MediaKind; size: number }
  | { kind: ArtifactKind; text: string; lang?: string }

export interface Thread {
  id: string
  requestId: string
  title: string
  objective: string
  agent: AgentId
  model?: string
  effort: Effort
  state: ThreadState
  note?: string
  /** set while state === 'waiting': the thread needs a decision from the user */
  question?: {
    text: string
    options?: string[]
    /** options[0] is the option the agent recommends (it was marked with * in OPCOES:) */
    recommended?: boolean
  }
  /** why the coordinator picked this agent/model/effort */
  why?: string
  /** skill the coordinator told the thread to load first */
  skill?: string
  /** execution plan of the current run (TodoWrite / plan tool) */
  todos: Todo[]
  /** short log of actions of the current run */
  steps: string[]
  /** start of the current run: media changed after it becomes artifact cards */
  runAt?: string
  /** files the thread created or edited, newest last (artifact cards) */
  files?: ThreadFile[]
  summary?: string
  /** what the thread says is still open (its PENDENTE: line); a done thread without it is resolved */
  pending?: string
  /** auto-resolved: done with nothing pending, folded away in the overview */
  resolved?: boolean
  /** set while the run waits for the user to allow a tool call */
  approval?: ToolApproval
  /** what the user allowed for good in this thread ("always"): tool families and command heads */
  allow?: string[]
  /** the user allowed every tool call in this thread */
  allowAll?: boolean
  /** connector logins this thread waits on */
  logins?: ThreadLogin[]
  /** last sign of life of the current run (any agent message); a long silence shows as "parada" */
  aliveAt?: string
  /** context window of the last call: tokens in use and the model's limit */
  context?: ContextUse
  sessionId?: string
  /** files of the request that opened the thread, sent with its first run */
  attachments?: Attachment[]
  messages: Message[]
  usage: Usage
  createdAt: string
  updatedAt: string
  /** brought back from the archive: counts as recent activity for the retention rule */
  restoredAt?: string
  /** set aside: superseded by another thread (by/byTitle) or discarded; not pending, not red */
  retired?: { reason: 'superseded' | 'discarded'; by?: string; byTitle?: string; at: string }
}

export interface ProcessInfo {
  id: string
  name: string
  command: string
  state: 'running' | 'exited'
  exitCode?: number | null
  /** ports seen in the process output (localhost:PORT) */
  ports: number[]
  log: string[]
  startedAt: string
}

export interface Project {
  id: string
  name: string
  path: string | null
  demo: boolean
  messages: Message[]
  threads: Thread[]
  /** turns: calls in the current session, which restarts every few dozen (the project memory carries over) */
  coordinator: { agent?: AgentId; sessionId?: string; usage: Usage; turns?: number; context?: ContextUse; compactedAt?: string }
  /** coordinator call in flight */
  busy: boolean
  synthesized: string[]
  /** dev servers and other long-running commands started by the user */
  processes: ProcessInfo[]
  /** threads moved to the archive file (kept out of the state and the IPC); recomputed at startup */
  archived?: { count: number; usage: Usage }
  /** never shown to remote devices */
  remoteHidden?: boolean
  /** the user archived the project: listed under "Arquivados" at the end of the sidebar (the folder is untouched) */
  archivedAt?: string
  /** which machine owns the project: set only in the renderer's merged state, never saved */
  machine?: { id: string; name: string; os: MachineOs; remote: boolean; online: boolean; since?: string }
}

/** One archived thread, as listed on demand by the board (no messages). */
export interface ArchivedThreadInfo {
  projectId: string
  projectName: string
  id: string
  title: string
  agent: AgentId
  state: ThreadState
  summary?: string
  note?: string
  createdAt: string
  updatedAt: string
}

/** When an idle coordinator gets its context compacted. */
export interface IdleCompactCfg {
  enabled: boolean
  /** idle minutes before compacting (inside the prompt cache window) */
  minutes: number
  /** context tokens below which there is nothing worth compacting */
  minTokens: number
}

/** app-wide preferences, saved across restarts */
export interface AppSettings {
  /** new threads (any project) start with "permitir tudo" on */
  allowAllThreads?: boolean
  /** project selected when the app closed */
  lastProjectId?: string
  /** projectId -> ISO time the user last had the project open (sidebar "novidades") */
  lastSeen?: Record<string, string>
  /** keep the machine awake while a thread or the coordinator works (default on) */
  keepAwake?: boolean
  /** compact an idle coordinator's context (default on) */
  idleCompact?: IdleCompactCfg
  /** LAN host server for other BrandyTerm machines (default off) */
  remote?: { enabled: boolean; port: number }
  /** skills library repo, `dono/repo` or an https URL (default 'ebrandes/claude-kit') */
  skillsLibrary?: string
}

export interface AgentInfo {
  id: AgentId
  name: string
  installed: boolean
  version?: string
  note: string
}

/** An entry of the skills library catalog (`biblioteca/catalogo.json`). */
export interface CatalogItem {
  id: string
  tipo: 'plugin' | 'skill'
  descricao: string
  tags: string[]
  /** in every project unless the list puts it in `sem` */
  sempre?: boolean
  /** never copied, staged or scanned off-machine */
  corporativo?: boolean
  plataformas?: ('mac' | 'win')[]
  /** `dono/repo` for `claude plugin marketplace add` when the store isn't known yet */
  loja?: string
}

/** A project's skills list (`<projeto>/.brandyterm/skills.json`). */
export interface SkillsList {
  versao: 1
  plugins: { id: string; ref?: string }[]
  skills: string[]
  sem: string[]
}

/** A plugin from the user's own Claude Code install that threads may load. */
export interface UserPlugin {
  id: string
  name: string
  version?: string
  /** `project`: installed for one project only, loaded only in that project's threads */
  scope: 'user' | 'project'
  /** folder name of that project */
  project?: string
  description?: string
  skills: number
  commands: number
  agents: number
  /** hooks run on every thread (they can change the output style) */
  hooks: boolean
  /** ships an MCP server; threads never load it (--strict-mcp-config) */
  mcp: boolean
  on: boolean
}

export interface UserPluginsState {
  /** the user's ~/.claude/skills (and commands), as the plugin "pessoal" */
  personal?: { skills: number; commands: number; on: boolean }
  list: UserPlugin[]
}

export interface PluginInfo {
  id: string
  name: string
  /** `plugin` adds skills/agents/commands; `mcp` ships an MCP server; `tool` is a CLI hooked into runs (RTK) */
  kind: 'plugin' | 'mcp' | 'tool'
  /** plugin dir, or the binary path for a `tool`; undefined when not installed */
  dir?: string
  version?: string
  /** optional plugins are installed by the user from the sidebar */
  optional?: boolean
  /** true while `claude plugin install` runs */
  installing?: boolean
  /** last install error, shown in the sidebar */
  error?: string
  /** loaded only by the security scan, never in threads (claude-security) */
  scanner?: boolean
  /** claude-security result of the last install attempt; `blocked` waits for the user */
  review?: { summary: string; report?: string; blocked: boolean }
  note: string
}

export interface LimitWindow {
  /** 0..1 of the window already used */
  utilization: number
  /** epoch seconds */
  resetsAt?: number
}

/** A Claude subscription BrandyTerm can bill: the CLI's own login or a `claude setup-token` token. */
export interface ClaudeAccount {
  id: string
  label: string
  kind: 'login' | 'token'
  /** plan reported by `claude auth status` (login account only) */
  plan?: string
  fiveHour?: LimitWindow
  sevenDay?: LimitWindow
  /** the subscription refused requests until this epoch second */
  limitedUntil?: number
  checkedAt?: string
  checking?: boolean
  error?: string
}

export interface AccountsState {
  list: ClaudeAccount[]
  activeId: string
  /** switch to another account when the active one reaches its limit */
  autoSwitch: boolean
  /** last automatic switch, shown in the sidebar */
  lastSwitch?: string
  /** `claude setup-token` running for a new account */
  login?: { label: string; error?: string }
}

export interface AppState {
  projects: Project[]
  agents: AgentInfo[]
  plugins: PluginInfo[]
  accounts?: AccountsState
  userPlugins?: UserPluginsState
  settings?: AppSettings
  machine?: MachineInfo
  connectors?: ConnectorsState
}

export const MAX_ACTIVE_THREADS = 2

/** files per message */
export const MAX_FILES = 12

export function projectTokens(p: Project): number {
  const all = [p.coordinator.usage, ...p.threads.map((t) => t.usage), ...(p.archived ? [p.archived.usage] : [])]
  return all.reduce((n, u) => n + u.input + u.output, 0)
}
