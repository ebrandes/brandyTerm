// Follows the Skill tool calls of one run, to log whether each skill loaded. Never logs the call's arguments.
import { diagLog } from '../diag-log.ts'

const resultText = (content: unknown): string => {
  const text = Array.isArray(content) ? content.map((c) => c?.text ?? '').join(' ') : String(content ?? '')
  return text.slice(0, 300)
}

export function skillLoads() {
  const pending = new Map<string, string>()
  return {
    use(block: any): void {
      if (block?.name !== 'Skill') return
      const skill = String(block.input?.skill ?? '')
      if (block.id) pending.set(String(block.id), skill)
      diagLog('skills', 'info', 'carregando skill', { skill })
    },
    result(block: any): void {
      if (block?.type !== 'tool_result') return
      const id = String(block.tool_use_id)
      const skill = pending.get(id)
      if (skill === undefined) return
      pending.delete(id)
      if (block.is_error) diagLog('skills', 'warn', 'falha ao carregar skill', { skill, error: resultText(block.content) })
      else diagLog('skills', 'info', 'skill carregada', { skill })
    }
  }
}
