import type { AgentId } from '../../shared/types.ts'
import type { AgentAdapter } from './types.ts'
import { claudeAdapter } from './claude.ts'
import { codexAdapter } from './codex.ts'
import { antigravityAdapter } from './antigravity.ts'

export const ADAPTERS: Record<AgentId, AgentAdapter> = { claude: claudeAdapter, codex: codexAdapter, antigravity: antigravityAdapter }
