import type { Engine } from './engine.ts'
import { compactCoordinator } from './compact.ts'
import { DEFAULT_IDLE_COMPACT, idleCompactDue } from '../shared/idle.ts'
import type { IdleCompactCfg } from '../shared/types.ts'

const TICK_MS = 30_000

/**
 * Every 30 s, compacts the context of each idle Claude coordinator that is due
 * (see idleCompactDue). Goes through engine.enqueue, so a message sent meanwhile waits
 * for the compaction and is never lost. The due check runs again inside the job: a
 * message that arrived while queued cancels it. Failures are already quiet system notes.
 */
export function startIdleCompact(e: Engine, cfg: () => IdleCompactCfg = () => DEFAULT_IDLE_COMPACT): () => void {
  const timer = setInterval(() => {
    const c = cfg()
    for (const p of e.state.projects) {
      if (!p.path || !idleCompactDue(p, Date.now(), c)) continue
      e.enqueue(p, async () => {
        const now = Date.now()
        if (!idleCompactDue(p, now, c)) return
        const minutes = Math.floor((now - Date.parse(p.messages.at(-1)?.time ?? '0')) / 60_000)
        await compactCoordinator(e, p)
        p.messages.push(e.msg('system', `Contexto do coordenador compactado automaticamente (parado há ${minutes} min).`))
        e.touch()
      })
    }
  }, TICK_MS)
  return () => clearInterval(timer)
}
