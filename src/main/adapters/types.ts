import type { AgentId, AgentInfo, Effort, Todo } from '../../shared/types.ts'

export interface RunOpts {
  cwd: string
  prompt: string
  sessionId?: string
  model?: string
  effort?: Effort
  /** 'none' = pure text (coordinator); 'readonly' = may read the project, never write */
  tools: 'none' | 'readonly'
  /** JSON schema for the final answer (honoured by claude; codex relies on the prompt) */
  schema?: object
  /** plugin directories loaded in every run (claude --plugin-dir) */
  plugins?: string[]
  /** compact the session automatically when it reaches this many tokens */
  autocompact?: number
}

export type AgentEvent =
  | { kind: 'session'; sessionId: string }
  | { kind: 'activity'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'todos'; items: Todo[] }
  | { kind: 'usage'; input: number; output: number; cached: number; costUsd?: number }
  | { kind: 'done'; ok: boolean; text: string; structured?: unknown; error?: string }

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
