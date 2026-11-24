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

export const codexAdapter: AgentAdapter = {
  id: 'codex',
  models: [],

  async detect() {
    const cli = resolveCli('codex')
    if (!cli) return { id: 'codex', name: 'Codex', installed: false, note: 'não instalado' }
    const version = await versionOf(cli.cmd, cli.prefix)
    return { id: 'codex', name: 'Codex', installed: true, version, note: 'codex exec --json, sandbox somente leitura' }
  },

  run(opts: RunOpts, onEvent: (e: AgentEvent) => void): RunHandle {
    const cli = resolveCli('codex')
    if (!cli) {
      onEvent({ kind: 'done', ok: false, text: '', error: 'Codex CLI não encontrado' })
      return { done: Promise.resolve(), cancel() {} }
    }
    const args = ['exec']
    if (opts.sessionId) args.push('resume', opts.sessionId)
    args.push('--json', '--skip-git-repo-check')
    // always read-only: headless runs cannot ask for approval
    if (opts.sessionId) args.push('-c', 'sandbox_mode="read-only"')
    else args.push('-s', 'read-only', '-C', opts.cwd)
    if (opts.model) args.push('-m', opts.model)
    if (opts.effort) args.push('-c', `model_reasoning_effort="${opts.effort}"`)
    if (opts.autocompact) args.push('-c', `model_auto_compact_token_limit=${opts.autocompact}`)
    args.push('-')

    let finished = false
    const finish = (e: Extract<AgentEvent, { kind: 'done' }>) => {
      if (finished) return
      finished = true
      onEvent(e)
    }
    let lastText = ''
    let lastError = ''

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
        switch (ev.type) {
          case 'thread.started':
            if (ev.thread_id) onEvent({ kind: 'session', sessionId: ev.thread_id })
            break
          case 'item.started':
          case 'item.updated':
          case 'item.completed': {
            const it = ev.item ?? {}
            if (it.type === 'todo_list' && Array.isArray(it.items)) {
              onEvent({
                kind: 'todos',
                items: it.items.map((x: any, i: number, all: any[]) => ({
                  text: String(x.text ?? ''),
                  status: x.completed ? 'completed' : all.findIndex((y: any) => !y.completed) === i ? 'in_progress' : 'pending'
                }))
              })
            } else if (it.type === 'agent_message' && it.text && ev.type === 'item.completed') lastText = it.text
            else if (it.type === 'command_execution' && ev.type === 'item.started') {
              onEvent({ kind: 'activity', text: `$ ${String(it.command ?? '').slice(0, 140)}` })
            } else if (it.type === 'file_change' || it.type === 'mcp_tool_call' || it.type === 'web_search') {
              if (ev.type === 'item.started') onEvent({ kind: 'activity', text: it.type })
            }
            break
          }
          case 'turn.completed': {
            const u = ev.usage ?? {}
            onEvent({
              kind: 'usage',
              input: u.input_tokens ?? 0,
              output: (u.output_tokens ?? 0) + (u.reasoning_output_tokens ?? 0),
              cached: u.cached_input_tokens ?? 0
            })
            finish({ kind: 'done', ok: true, text: lastText })
            break
          }
          case 'turn.failed':
            lastError = ev.error?.message ?? 'turno falhou'
            finish({ kind: 'done', ok: false, text: lastText, error: lastError })
            break
          case 'error':
            lastError = ev.message ?? lastError
            break
        }
      }
    })

    return {
      cancel: run.cancel,
      done: run.done.then(({ code, stderr, cancelled }) => {
        if (cancelled) finish({ kind: 'done', ok: false, text: lastText, error: 'cancelado' })
        else finish({ kind: 'done', ok: false, text: lastText, error: lastError || stderr.trim().slice(-600) || `codex saiu com código ${code}` })
      })
    }
  }
}
