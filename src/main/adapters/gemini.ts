import type { AgentAdapter, RunHandle } from './types.ts'
import { resolveCli } from './proc.ts'

/**
 * Gemini CLI headless is planned (spec section 6). Until the CLI is installed and its
 * capabilities are captured, this adapter only reports availability and never runs.
 */
export const geminiAdapter: AgentAdapter = {
  id: 'gemini',
  models: [],
  async detect() {
    const found = resolveCli('gemini')
    return {
      id: 'gemini',
      name: 'Gemini',
      installed: false,
      note: found ? 'detectado, adaptador ainda não implementado' : 'não instalado'
    }
  },
  run(_opts, onEvent): RunHandle {
    onEvent({ kind: 'done', ok: false, text: '', error: 'Gemini ainda não está disponível' })
    return { done: Promise.resolve(), cancel() {} }
  }
}
