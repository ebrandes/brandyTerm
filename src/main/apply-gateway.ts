// The `app_status` and `queue_apply` tools of the thread gateway (op 'app').
import type { ApplyQueue } from './apply-queue.ts'
import type { GwHandler } from './connectors/gateway-server.ts'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function appGateway(queue: ApplyQueue): GwHandler {
  return async (ref, req) => {
    if (req.tool === 'app_status') {
      const running = queue.running().map(({ threadId, projectId: _, ...r }) => ({ ...r, ...(threadId === ref.threadId ? { voce: true } : {}) }))
      const queued = queue.list().map((i) => ({ title: i.title, branch: i.branch, status: i.status, ...(i.error ? { error: i.error } : {}) }))
      return { count: running.length, running, queue: queued }
    }
    if (req.tool === 'queue_apply') {
      const a = (req.args ?? {}) as Record<string, unknown>
      const r = await queue.request(ref.projectId, ref.threadId, { worktree: str(a.worktree), title: str(a.title), base: str(a.base) || undefined })
      return [
        `Na fila (posição ${r.position}). ${r.auto
          ? 'Não precisa de aprovação: o app aplica sozinho quando nada estiver rodando.'
          : 'Como a mudança reinicia o app, o usuário aprova uma vez no painel "Aplicações" do menu lateral; o app aplica sozinho quando nada estiver rodando.'}`,
        'Não pergunte nada sobre isso e não aplique à mão. Encerre com RESUMO.',
        ...(r.warning ? [`ATENÇÃO: ${r.warning}`] : [])
      ].join('\n')
    }
    throw new Error(`Ferramenta desconhecida: ${req.tool}`)
  }
}
