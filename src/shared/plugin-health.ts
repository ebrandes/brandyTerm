/** Whether a token-saving tool really acts on one kind of agent, as checked when the app opened. */
export interface AgentCoverage {
  agent: 'claude' | 'codex'
  ok: boolean
  detail: string
}
