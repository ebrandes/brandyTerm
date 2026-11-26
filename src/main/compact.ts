import type { Project } from '../shared/types.ts'
import { ADAPTERS } from './adapters/index.ts'
import { addUsage, runOnce } from './run.ts'
import type { Engine } from './engine.ts'

/**
 * Runs `/compact` on the coordinator's Claude session. Shared by the `/compact` command
 * and idle compaction, so there is one copy of the logic. Call inside `engine.enqueue`.
 */
export async function compactCoordinator(e: Engine, p: Project): Promise<void> {
  const s = p.coordinator
  const r = await runOnce(ADAPTERS.claude, { cwd: p.path!, prompt: '/compact', sessionId: s.sessionId, tools: 'none', tag: { kind: 'compact', projectId: p.id } }).result
  addUsage(s.usage, r.usage)
  if (r.sessionId) s.sessionId = r.sessionId
  const ok = r.done?.ok !== false
  if (ok) s.compactedAt = new Date().toISOString()
  p.messages.push(e.msg('system', ok ? 'Contexto compactado.' : `Falha ao compactar: ${r.done?.error ?? 'sem resposta'}`, { isError: !ok }))
  e.touch()
}
