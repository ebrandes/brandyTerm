import { execFile } from 'node:child_process'
import type { AgentAdapter, AgentEvent, RunHandle, RunOpts } from './types.ts'
import { resolveCli, spawnCli } from './proc.ts'

function versionOf(cmd: string, prefix: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(cmd, [...prefix, '--version'], { timeout: 15000, windowsHide: true }, (err, out) =>
      resolve(err ? undefined : out.trim().split('\n')[0])
    )
  })
}

function describeTool(name: string, input: Record<string, unknown> | undefined): string {
  const arg = input?.file_path ?? input?.path ?? input?.pattern ?? input?.command ?? ''
  return `${name} ${String(arg)}`.trim().slice(0, 140)
}

export const claudeAdapter: AgentAdapter = {
  id: 'claude',
  models: ['haiku', 'sonnet', 'opus'],

  async detect() {
    const cli = resolveCli('claude')
    if (!cli) return { id: 'claude', name: 'Claude', installed: false, note: 'não instalado' }
    const version = await versionOf(cli.cmd, cli.prefix)
    return { id: 'claude', name: 'Claude', installed: true, version, note: 'Claude Code CLI, modo headless' }
  },

  run(opts: RunOpts, onEvent: (e: AgentEvent) => void): RunHandle {
    const cli = resolveCli('claude')
    if (!cli) {
      onEvent({ kind: 'done', ok: false, text: '', error: 'Claude CLI não encontrado' })
      return { done: Promise.resolve(), cancel() {} }
    }
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      // skip the user's global hooks/plugins: they bloat context and change the output style
      '--setting-sources',
      'project',
      '--tools',
      opts.tools === 'none' ? '' : 'Read,Grep,Glob,TaskCreate,TaskUpdate,TaskList,TodoWrite',
      // do not load the user's MCP connectors in headless runs: noise and tokens
      '--strict-mcp-config'
    ]
    if (opts.sessionId) args.push('--resume', opts.sessionId)
    if (opts.model) args.push('--model', opts.model)
    if (opts.effort) args.push('--effort', opts.effort)
    if (opts.schema) args.push('--json-schema', JSON.stringify(opts.schema))
    if (opts.autocompact) args.push('--autocompact', String(opts.autocompact))
    for (const dir of opts.plugins ?? []) args.push('--plugin-dir', dir)

    let finished = false
    const finish = (e: Extract<AgentEvent, { kind: 'done' }>) => {
      if (finished) return
      finished = true
      onEvent(e)
    }
    let lastText = ''
    // Claude Code 2.1.x plans with TaskCreate/TaskUpdate; ids are sequential per session
    const tasks: { text: string; status: 'pending' | 'in_progress' | 'completed' }[] = []
    const emitTasks = () => onEvent({ kind: 'todos', items: tasks.map((t) => ({ ...t })) })

    const run = spawnCli(cli, args, {
      cwd: opts.cwd,
      input: opts.prompt,
      onLine: (line) => {
        let ev: any
        try {
          ev = JSON.parse(line)
        } catch {
          return
        }
        if (ev.session_id && (ev.type === 'system' || ev.type === 'result')) {
          onEvent({ kind: 'session', sessionId: ev.session_id })
        }
        if (ev.type === 'assistant') {
          for (const b of ev.message?.content ?? []) {
            if (b.type === 'tool_use' && b.name === 'TaskCreate' && typeof b.input?.subject === 'string') {
              tasks.push({ text: b.input.subject, status: 'pending' })
              emitTasks()
            } else if (b.type === 'tool_use' && b.name === 'TaskUpdate') {
              const t = tasks[Number(b.input?.taskId) - 1]
              const st = b.input?.status
              if (t && (st === 'pending' || st === 'in_progress' || st === 'completed')) t.status = st
              if (t && typeof b.input?.subject === 'string') t.text = b.input.subject
              emitTasks()
            } else if (b.type === 'tool_use' && b.name === 'TaskList') {
              // read-only listing, nothing to show
            } else if (b.type === 'tool_use' && b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) {
              onEvent({
                kind: 'todos',
                items: b.input.todos.map((t: any) => ({
                  text: String(t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content),
                  status: t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending'
                }))
              })
            } else if (b.type === 'tool_use') onEvent({ kind: 'activity', text: describeTool(b.name, b.input) })
            else if (b.type === 'text' && b.text) lastText = b.text
          }
        } else if (ev.type === 'result') {
          const u = ev.usage ?? {}
          onEvent({
            kind: 'usage',
            input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
            output: u.output_tokens ?? 0,
            cached: u.cache_read_input_tokens ?? 0,
            costUsd: ev.total_cost_usd
          })
          const ok = ev.subtype === 'success' && !ev.is_error
          finish({
            kind: 'done',
            ok,
            text: typeof ev.result === 'string' && ev.result ? ev.result : lastText,
            structured: ev.structured_output,
            error: ok ? undefined : String(ev.result ?? ev.subtype ?? 'erro desconhecido')
          })
        }
      }
    })

    return {
      cancel: run.cancel,
      done: run.done.then(({ code, stderr, cancelled }) => {
        if (cancelled) finish({ kind: 'done', ok: false, text: lastText, error: 'cancelado' })
        else finish({ kind: 'done', ok: false, text: lastText, error: stderr.trim() || `claude saiu com código ${code}` })
      })
    }
  }
}
