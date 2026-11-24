import { Asterisk, Code2, Gem } from 'lucide-react'
import type { AgentId } from '../types'

export function AgentBadge({ agent, size = 'md' }: { agent: AgentId; size?: 'sm' | 'md' }) {
  const Icon = agent === 'claude' ? Asterisk : agent === 'codex' ? Code2 : Gem
  return (
    <span className={`agent-badge ${size} agent-${agent}`}>
      <Icon size={size === 'sm' ? 13 : 17} strokeWidth={2.2} />
    </span>
  )
}
