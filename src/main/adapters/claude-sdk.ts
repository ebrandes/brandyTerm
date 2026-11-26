import { dirname } from 'node:path'
import type { CanUseTool, Options, PermissionResult, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { SdkSession } from './claude-session.ts'
import { resolveCli } from './proc.ts'
import type { AgentEvent, RunHandle, RunOpts } from './types.ts'
import { LIMIT_RE, claudeAuth } from './auth.ts'
import { claudeStream, describeTool } from './claude-events.ts'
import { attachmentText, claudeUserMessage } from '../attach-content.ts'
import { gatewayFor } from './gateway-launch.ts'
import { claudeEnv } from './claude-env.ts'
import { readOnlyBashRules, rtkBin, rtkSettings } from '../rtk.ts'

/**
 * Claude runs through the Agent SDK. Same session files and flags as the CLI path, plus:
 * - threads ('work') get `canUseTool`: anything not pre-allowed (a Bash command that changes
 *   things, an edit, a web fetch) waits for the user's answer in the thread instead of failing;
 * - `keepAlive` runs (the coordinator) reuse one live process per key across turns.
 */

const TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Skill', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TodoWrite']
/** never asked: reading, planning and loading skills */
const FREE = ['Read', 'Grep', 'Glob', 'Skill', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TodoWrite']

/** the gateway's tools: approval happens in the hub, so they are never asked here */
const BRANDY_TOOLS = ['list_connectors', 'connector_tools', 'call_connector', 'app_status', 'queue_apply'].map((n) => `mcp__brandy__${n}`)
/** a connector call may wait for the user (approval, login): longer than the 60 s default */
const MCP_TOOL_TIMEOUT_MS = '960000'

/** a kept-alive session closes after this long without a turn (the next one resumes it) */
const IDLE_MS = 10 * 60_000

interface Live {
  session: SdkSession
  account: string
  model?: string
  timer?: ReturnType<typeof setTimeout>
}
const live = new Map<string, Live>()

/** Closes every kept-alive session (app quitting). */
export function closeSdkSessions(): void {
  for (const l of live.values()) {
    if (l.timer) clearTimeout(l.timer)
    l.session.close()
  }
  live.clear()
}

/** The user's own Claude Code when it is a native binary (it updates itself); else the SDK's bundled one. */
function executable(): string | undefined {
  const cli = resolveCli('claude')
  return cli && !cli.prefix.length ? cli.cmd : undefined
}

function detailOf(tool: string, input: Record<string, unknown>): string | undefined {
  const s = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))
  let d: string | undefined
  if (tool === 'Bash') d = s(input.command)
  else if (tool === 'Edit') d = `${s(input.file_path)}\n--- antes\n${s(input.old_string)}\n+++ depois\n${s(input.new_string)}`
  else if (tool === 'Write') d = `${s(input.file_path)}\n${s(input.content)}`
  else d = s(input)
  return d && d.length > 2000 ? d.slice(0, 2000) + '\n…' : d
}

export function buildOptions(opts: RunOpts, env: Record<string, string | undefined>, canUseTool: CanUseTool): Options {
  const work = opts.tools === 'work'
  const gw = work ? gatewayFor(opts.thread) : null
  const rtk = work ? rtkBin() : null
  const atts = opts.attachments ?? []
  return {
    cwd: opts.cwd,
    env: gw ? { ...env, MCP_TOOL_TIMEOUT: MCP_TOOL_TIMEOUT_MS } : env,
    pathToClaudeCodeExecutable: executable(),
    model: opts.model,
    effort: opts.effort,
    resume: opts.sessionId,
    // the user's global hooks/plugins stay out; plugins the user turned on come in as plugin dirs
    settingSources: ['project'],
    strictMcpConfig: true,
    tools: work ? TOOLS : [],
    allowedTools: work ? [...FREE, ...(gw ? BRANDY_TOOLS : []), ...readOnlyBashRules(!!rtk)] : [],
    // alwaysLoad: the three tools are in the turn-1 prompt, never deferred behind tool search
    ...(gw ? { mcpServers: { brandy: { type: 'stdio' as const, command: gw.command, args: gw.args, env: gw.env, alwaysLoad: true, timeout: Number(MCP_TOOL_TIMEOUT_MS) } } } : {}),
    permissionMode: 'default',
    ...(work ? { canUseTool } : {}),
    plugins: (opts.plugins ?? []).map((path) => ({ type: 'local' as const, path })),
    // threads may re-read an attachment by path
    additionalDirectories: [...new Set(atts.map((a) => dirname(a.path)))],
    ...(opts.schema ? { outputFormat: { type: 'json_schema' as const, schema: opts.schema as Record<string, unknown> } } : {}),
    ...(rtk ? { settings: rtkSettings(rtk) } : {}),
    ...(opts.autocompact ? { extraArgs: { autocompact: String(opts.autocompact) } } : {})
  }
}

export function runClaudeSdk(opts: RunOpts, onEvent: (e: AgentEvent) => void): RunHandle {
  const account = claudeAuth().pick()
  const env: Record<string, string | undefined> = claudeEnv(account.env)
  const stream = claudeStream(onEvent, account.id)
  let finished = false
  const finish = (e: Extract<AgentEvent, { kind: 'done' }>) => {
    if (finished) return
    finished = true
    const limited = !e.ok && e.error !== 'cancelado' && (stream.rejected || LIMIT_RE.test(e.error ?? ''))
    onEvent({ ...e, limited, account: account.id })
  }

  // "always" is remembered by BrandyTerm on the thread (allow-rules.ts), not as SDK permission
  // updates: those may write to the project's .claude/settings.local.json
  const canUseTool: CanUseTool = async (tool, input, { signal, blockedPath }): Promise<PermissionResult> => {
    if (tool.startsWith('mcp__brandy__')) return { behavior: 'allow', updatedInput: input }
    if (!opts.approve) return { behavior: 'deny', message: 'Execução sem aprovação disponível: a ferramenta foi negada.' }
    const summary = describeTool(tool, input)
    const d = await opts.approve({ tool, input, summary, detail: detailOf(tool, input), blockedPath, signal })
    if (d === 'deny') return { behavior: 'deny', message: `O usuário negou ${summary}. Siga sem isso ou pergunte com PERGUNTA:.` }
    return { behavior: 'allow', updatedInput: input }
  }

  // a kept-alive session is reused only while it is the same conversation on the same account and model
  const key = opts.keepAlive
  let l = key ? live.get(key) : undefined
  if (l && (!l.session.alive || l.account !== account.id || l.model !== opts.model || !opts.sessionId || l.session.sessionId !== opts.sessionId)) {
    l.session.close()
    if (l.timer) clearTimeout(l.timer)
    live.delete(key!)
    l = undefined
  }
  if (l?.timer) clearTimeout(l.timer)
  const session = l?.session ?? new SdkSession(buildOptions(opts, env, canUseTool))
  if (key && !l) live.set(key, { session, account: account.id, model: opts.model })

  const atts = opts.attachments ?? []
  const m = JSON.parse(claudeUserMessage(opts.prompt + attachmentText(atts), atts))
  const message = { type: 'user', message: m.message, parent_tool_use_id: null } as SDKUserMessage

  const done = session
    .send(message, (ev) => {
      const d = stream.handle(ev)
      if (d) finish(d)
      return !!d
    })
    .then((err) => {
      if (err) finish({ kind: 'done', ok: false, text: stream.lastText, error: err })
      const entry = key ? live.get(key) : undefined
      if (!key) session.close()
      else if (entry?.session === session) {
        if (!session.alive) live.delete(key)
        else {
          entry.timer = setTimeout(() => (session.close(), live.delete(key)), IDLE_MS)
          entry.timer.unref?.()
        }
      }
    })

  return {
    done,
    cancel: () => {
      session.close()
      if (key && live.get(key)?.session === session) live.delete(key)
    }
  }
}
