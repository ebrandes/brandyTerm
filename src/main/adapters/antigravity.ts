import type { AgentAdapter, RunHandle } from './types.ts'
import { resolveCli } from './proc.ts'

/**
 * Antigravity CLI (`agy`) headless is planned (spec section 6). Until the CLI is installed and its
 * capabilities are captured, this adapter only reports availability and never runs.
 */
export const antigravityAdapter: AgentAdapter = {
  id: 'antigravity',
  models: [],
  async detect() {
    const found = resolveCli('agy')
    return {
      id: 'antigravity',
      name: 'Antigravity',
      installed: false,
      note: found ? 'detectado, adaptador ainda não implementado' : 'não instalado'
    }
  },
  run(_opts, onEvent): RunHandle {
    onEvent({ kind: 'done', ok: false, text: '', error: 'Antigravity ainda não está disponível' })
    return { done: Promise.resolve(), cancel() {} }
  }
}
