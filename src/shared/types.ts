export type AgentId = 'claude' | 'codex' | 'gemini'
export type ThreadState = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'interrupted' | 'cancelled'
export type Effort = 'low' | 'medium' | 'high'

export const AGENT_NAMES: Record<AgentId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini'
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

export interface Message {
  id: string
  author: 'user' | 'coordinator' | 'agent' | 'system'
  time: string
  text: string
  summaries?: Summary[]
  isError?: boolean
  /** a thread is asking the user something; answer routes back to that thread */
  ask?: { threadId: string; question: string; options?: string[] }
}

export interface Todo {
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

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
  question?: { text: string; options?: string[] }
  /** why the coordinator picked this agent/model/effort */
  why?: string
  /** execution plan of the current run (TodoWrite / plan tool) */
  todos: Todo[]
  /** short log of actions of the current run */
  steps: string[]
  summary?: string
  sessionId?: string
  messages: Message[]
  usage: Usage
  createdAt: string
  updatedAt: string
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
  coordinator: { agent?: AgentId; sessionId?: string; usage: Usage }
  /** coordinator call in flight */
  busy: boolean
  synthesized: string[]
  /** dev servers and other long-running commands started by the user */
  processes: ProcessInfo[]
}

export interface AgentInfo {
  id: AgentId
  name: string
  installed: boolean
  version?: string
  note: string
}

export interface PluginInfo {
  id: string
  name: string
  /** absolute plugin dir, undefined when not installed */
  dir?: string
  version?: string
  note: string
}

export interface AppState {
  projects: Project[]
  agents: AgentInfo[]
  plugins: PluginInfo[]
}

export const MAX_ACTIVE_THREADS = 2

export function projectTokens(p: Project): number {
  const all = [p.coordinator.usage, ...p.threads.map((t) => t.usage)]
  return all.reduce((n, u) => n + u.input + u.output, 0)
}
