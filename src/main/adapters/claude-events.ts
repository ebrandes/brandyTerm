import { fileFromTool } from '../artifact-files.ts'
import type { AgentEvent } from './types.ts'
import { claudeAuth } from './auth.ts'
import { skillLoads } from './skill-log.ts'

/** Short one-line description of a tool call, for the thread's activity log and approval cards. */
export function describeTool(name: string, input: Record<string, unknown> | undefined): string {
  const arg = input?.file_path ?? input?.path ?? input?.pattern ?? input?.command ?? input?.url ?? ''
  return `${name} ${String(arg)}`.trim().slice(0, 140)
}

type Done = Extract<AgentEvent, { kind: 'done' }>

/** The model that carried the run: the costliest in `modelUsage` (small helper calls also show there). */
function mainModel(usage: Record<string, any> | undefined): string | undefined {
  return Object.entries(usage ?? {}).sort(([, a], [, b]) => (Number(b?.costUSD) || 0) - (Number(a?.costUSD) || 0))[0]?.[0]
}

/**
 * Turns Claude Code stream messages (the CLI's stream-json lines and the Agent SDK's
 * SDKMessage objects share the shape) into BrandyTerm AgentEvents. `handle` returns the
 * done event of a `result` message, so the caller decides how to finish the run.
 */
export function claudeStream(onEvent: (e: AgentEvent) => void, accountId: string) {
  let lastText = ''
  let rejected = false
  let lastCall = ''
  // Write/Edit calls waiting for their result: a denied or failed call makes no card
  const pendingFiles = new Map<string, { path: string; op: 'write' | 'edit' }>()
  const skills = skillLoads()
  // Claude Code 2.1.x plans with TaskCreate/TaskUpdate; ids are sequential per session
  const tasks: { text: string; status: 'pending' | 'in_progress' | 'completed' }[] = []
  const emitTasks = () => onEvent({ kind: 'todos', items: tasks.map((t) => ({ ...t })) })

  const toolUse = (b: any) => {
    skills.use(b)
    if (b.name === 'TaskCreate' && typeof b.input?.subject === 'string') {
      tasks.push({ text: b.input.subject, status: 'pending' })
      emitTasks()
    } else if (b.name === 'TaskUpdate') {
      const t = tasks[Number(b.input?.taskId) - 1]
      const st = b.input?.status
      if (t && (st === 'pending' || st === 'in_progress' || st === 'completed')) t.status = st
      if (t && typeof b.input?.subject === 'string') t.text = b.input.subject
      emitTasks()
    } else if (b.name === 'TaskList') {
      // read-only listing, nothing to show
    } else if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) {
      onEvent({
        kind: 'todos',
        items: b.input.todos.map((t: any) => ({
          text: String(t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content),
          status: t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending'
        }))
      })
    } else {
      const file = fileFromTool(b.name, b.input)
      if (file && b.id) pendingFiles.set(String(b.id), file)
      onEvent({ kind: 'activity', text: describeTool(b.name, b.input) })
    }
  }

  return {
    get lastText() {
      return lastText
    },
    get rejected() {
      return rejected
    },
    handle(ev: any): Done | undefined {
      if (ev.session_id && (ev.type === 'system' || ev.type === 'result')) onEvent({ kind: 'session', sessionId: ev.session_id })
      if (ev.type === 'rate_limit_event' && ev.rate_limit_info) {
        if (ev.rate_limit_info.status === 'rejected') rejected = true
        claudeAuth().report(accountId, ev.rate_limit_info)
      } else if (ev.type === 'assistant') {
        // one model call can arrive as several messages (one per block) with the same usage
        const u = ev.message?.usage
        if (u && ev.message?.id !== lastCall) {
          lastCall = ev.message?.id ?? ''
          const used = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0)
          if (used > 0) onEvent({ kind: 'context', used })
        }
        for (const b of ev.message?.content ?? []) {
          if (b.type === 'tool_use') toolUse(b)
          else if (b.type === 'text' && b.text) lastText = b.text
        }
      } else if (ev.type === 'user') {
        for (const b of Array.isArray(ev.message?.content) ? ev.message.content : []) {
          skills.result(b)
          const file = b?.type === 'tool_result' ? pendingFiles.get(String(b.tool_use_id)) : undefined
          if (!file) continue
          pendingFiles.delete(String(b.tool_use_id))
          if (!b.is_error) onEvent({ kind: 'file', ...file })
        }
      } else if (ev.type === 'result') {
        const windows = Object.values(ev.modelUsage ?? {}).map((m: any) => Number(m?.contextWindow) || 0)
        const limit = Math.max(0, ...windows)
        if (limit) onEvent({ kind: 'context', used: 0, limit })
        const u = ev.usage ?? {}
        onEvent({
          kind: 'usage',
          input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
          output: u.output_tokens ?? 0,
          cached: u.cache_read_input_tokens ?? 0,
          costUsd: ev.total_cost_usd,
          model: mainModel(ev.modelUsage)
        })
        const ok = ev.subtype === 'success' && !ev.is_error
        const errors = Array.isArray(ev.errors) && ev.errors.length ? ev.errors.join('; ') : undefined
        return {
          kind: 'done',
          ok,
          text: typeof ev.result === 'string' && ev.result ? ev.result : lastText,
          structured: ev.structured_output,
          error: ok ? undefined : String(ev.result ?? errors ?? ev.subtype ?? 'erro desconhecido')
        }
      } else onEvent({ kind: 'alive' })
      return undefined
    }
  }
}
