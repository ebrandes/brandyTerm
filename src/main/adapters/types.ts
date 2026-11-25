import type { AgentId, AgentInfo, ApprovalDecision, Attachment, Effort, Todo } from '../../shared/types.ts'

export interface ApprovalAsk {
  tool: string
  input: Record<string, unknown>
  /** one line: tool and its main argument */
  summary: string
  /** command, file or diff preview, truncated */
  detail?: string
  /** path outside the allowed folders that triggered the request, if any */
  blockedPath?: string
  signal: AbortSignal
}

export interface RunOpts {
  cwd: string
  prompt: string
  sessionId?: string
  model?: string
  effort?: Effort
  /** 'none' = pure text (coordinator); 'readonly' = may read the project, never write;
   * 'work' = thread that may run commands and edit, asking `approve` before anything not read-only;
   * 'scan' = claude-security scan in a throwaway folder (claude only) */
  tools: 'none' | 'readonly' | 'work' | 'scan'
  /** claude: keep one live process for this key across turns (the coordinator, per project) */
  keepAlive?: string
  /** 'work' runs: asks the user before a tool that is not pre-allowed; resolves with the decision */
  approve?: (r: ApprovalAsk) => Promise<ApprovalDecision>
  /** JSON schema for the final answer (honoured by claude; codex relies on the prompt) */
  schema?: object
  /** plugin directories loaded in every run (claude --plugin-dir) */
  plugins?: string[]
  /** compact the session automatically when it reaches this many tokens */
  autocompact?: number
  /** files sent with this prompt (images/PDFs as content, text inlined, others by path) */
  attachments?: Attachment[]
}

export type AgentEvent =
  | { kind: 'session'; sessionId: string }
  | { kind: 'activity'; text: string }
  /** a file the run created or edited (absolute path) */
  | { kind: 'file'; path: string; op: 'write' | 'edit' }
  | { kind: 'text'; text: string }
  | { kind: 'todos'; items: Todo[] }
  | { kind: 'usage'; input: number; output: number; cached: number; costUsd?: number }
  /** context in use after the last model call, and the model's window */
  | { kind: 'context'; used: number; limit?: number }
  /** any other sign that the run is still alive (tool progress, thinking) */
  | { kind: 'alive' }
  | { kind: 'done'; ok: boolean; text: string; structured?: unknown; error?: string; limited?: boolean; account?: string }

export interface RunHandle {
  done: Promise<void>
  cancel(): void
}

export interface AgentAdapter {
  id: AgentId
  detect(): Promise<AgentInfo>
  models: string[]
  run(opts: RunOpts, onEvent: (e: AgentEvent) => void): RunHandle
}
