import { randomUUID } from 'node:crypto'
import type { Attachment, Project, Thread } from '../shared/types.ts'
import { ADAPTERS } from './adapters/index.ts'
import { addUsage, runOnce } from './run.ts'
import { APP_COMMANDS, helpText } from './commands.ts'
import type { Engine } from './engine.ts'
import { compactCoordinator } from './compact.ts'
import { runSkillCommand, skillKind } from './skill-commands.ts'

/** `/clear`, `/compact`, `/help` and `/skill-*` here; any other command runs raw in a Claude thread, which expands it. */
export function runSlash(e: Engine, p: Project, cmd: { name: string; args: string }, t: Thread | undefined, atts: Attachment[]): void {
  const raw = `/${cmd.name}${cmd.args ? ' ' + cmd.args : ''}`
  const log = t ? t.messages : p.messages
  const note = (text: string, isError = false) => {
    log.push(e.msg('system', text, { isError }))
    e.touch()
  }
  if (skillKind(cmd.name)) return runSkillCommand(e, p, cmd, atts, t)
  if (!APP_COMMANDS.some((c) => c.name === cmd.name)) {
    const all = e.commands(p.id)
    // `/brainstorming` finds `superpowers:brainstorming` when only one plugin has it
    const hits = all.filter((c) => c.name.endsWith(`:${cmd.name}`))
    const name = all.some((c) => c.name === cmd.name) || hits.length !== 1 ? cmd.name : hits[0].name
    const text = `/${name}${cmd.args ? ' ' + cmd.args : ''}`
    if (t?.agent === 'claude') return e.sendToThread(p, t.id, text, atts, true)
    if (t) {
      log.push(e.msg('user', raw))
      return note('Comandos com / só rodam em threads do Claude.', true)
    }
    p.messages.push(e.msg('user', raw, { attachments: atts }))
    if (!e.installed().has('claude')) return note('Comandos com / precisam do Claude Code instalado.', true)
    const nt = e.createThread(p, { title: `/${name}`, objective: text, agent: 'claude', effort: 'medium', why: 'comando / do usuário' }, randomUUID(), atts)
    p.messages.push(e.msg('coordinator', `Rodando \`/${name}\` numa thread do Claude.`, { threads: [nt.id] }))
    return e.startThread(p, nt, text, true, atts)
  }
  log.push(e.msg('user', raw))
  if (cmd.name === 'help') return note(helpText(e.commands(p.id)))
  const s = t ?? p.coordinator
  if (t && (t.state === 'running' || t.state === 'queued')) return note('A thread está executando; espere terminar.', true)
  // a silent report/question may still be running in the session about to change
  if (t) e.reporter.cancel(t.id)
  if (cmd.name === 'clear') {
    s.sessionId = undefined
    return note(t ? 'Contexto da thread limpo: a próxima mensagem começa uma sessão nova.' : 'Contexto do coordenador limpo: a próxima mensagem começa uma conversa nova.')
  }
  const agent = t ? t.agent : p.coordinator.agent
  if (!s.sessionId || !agent) return note('Nada para compactar ainda.')
  if (agent !== 'claude') return note('O Codex já compacta sozinho ao passar do limite de contexto.')
  if (t) {
    // thread compaction: its own session, not the coordinator's
    void (async () => {
      const r = await runOnce(ADAPTERS.claude, { cwd: p.path!, prompt: '/compact', sessionId: s.sessionId, tools: 'none' }).result
      addUsage(s.usage, r.usage)
      if (r.sessionId) s.sessionId = r.sessionId
      note(r.done?.ok === false ? `Falha ao compactar: ${r.done.error ?? 'sem resposta'}` : 'Contexto compactado.', r.done?.ok === false)
    })()
    return
  }
  e.enqueue(p, () => compactCoordinator(e, p))
}
