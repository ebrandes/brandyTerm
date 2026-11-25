import type { Project } from '../shared/types.ts'
import type { Engine } from './engine.ts'
import { ADAPTERS } from './adapters/index.ts'
import { addUsage, runOnce } from './run.ts'
import { CONSOLIDATE_SCHEMA, MEMORY_LIMIT, MEMORY_TARGET, addNotes, consolidatePrompt, readMemory, writeMemory, type MemoryNote } from './memory.ts'

import { coordinatorLimit, shouldCompact } from '../shared/context-limit.ts'

export { AUTOCOMPACT, coordinatorAutocompact, coordinatorContext } from '../shared/context-limit.ts'

/** the coordinator starts a new session after this many calls; the memory file carries what matters */
export const SESSION_TURNS = 20

/**
 * Before a coordinator call: true when the session was restarted (the prompt then adds the recent chat
 * and the project memory). Past the context rule (`shouldCompact`) the old session is never resumed,
 * so the coordinator stays under `coordinatorContextLimit`.
 */
export function rotateSession(p: Project): boolean {
  const c = p.coordinator
  c.turns = (c.turns ?? 0) + 1
  const limit = coordinatorLimit(c.context?.limit)
  if (c.sessionId && (c.turns > SESSION_TURNS || shouldCompact(c.context?.used, limit))) {
    resetSession(p)
    c.turns = 1
  }
  if (c.context) c.context = { used: c.sessionId ? c.context.used : 0, limit }
  return !c.sessionId
}

/**
 * Drops the coordinator's session: the next call starts a new one, exactly like the rotation above
 * (the prompt then carries the project memory and the recent chat). Used by "Limpar contexto".
 * The memory file, the threads and the visible chat are not touched.
 */
export function resetSession(p: Project): void {
  const c = p.coordinator
  c.sessionId = undefined
  c.turns = 0
  if (c.context) c.context = { used: 0, limit: coordinatorLimit(c.context.limit) }
}

/** Saves the coordinator's notes; over the budget, a one-off call rewrites the memory compactly. */
export function remember(engine: Engine, p: Project, notes: MemoryNote[]): void {
  if (!p.path || !notes.length) return
  let size: number
  try {
    size = addNotes(p.path, notes)
  } catch (e) {
    return engine.fail(p, `Não consegui gravar a memória do projeto: ${(e as Error).message}`)
  }
  if (size > MEMORY_LIMIT) void consolidate(engine, p)
}

const busy = new Set<string>()

async function consolidate(engine: Engine, p: Project): Promise<void> {
  const root = p.path
  const agent = p.coordinator.agent
  if (!root || !agent || busy.has(p.id)) return
  busy.add(p.id)
  try {
    const text = readMemory(root)
    // no session: the rewrite must not land in the coordinator's conversation
    const { result } = runOnce(ADAPTERS[agent], { cwd: root, prompt: consolidatePrompt(text), tools: 'none', effort: 'low', schema: CONSOLIDATE_SCHEMA })
    const r = await result
    addUsage(p.coordinator.usage, r.usage)
    const out = (r.done?.structured as { memory?: unknown } | undefined)?.memory
    // a rewrite that lost most of the content, or did not shrink, is dropped
    const ok = typeof out === 'string' && out.includes('## ') && out.length < text.length && out.length > MEMORY_TARGET / 4
    // notes added while the rewrite ran would be lost: skip, the next note triggers it again
    if (ok && readMemory(root) === text) writeMemory(root, out)
  } finally {
    busy.delete(p.id)
    engine.touch()
  }
}
