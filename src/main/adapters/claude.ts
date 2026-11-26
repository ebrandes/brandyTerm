import { execFile } from 'node:child_process'
import type { AgentAdapter, AgentEvent, RunHandle, RunOpts } from './types.ts'
import { resolveCli, spawnCli } from './proc.ts'
import { attachmentText, claudeUserMessage } from '../attach-content.ts'
import { LIMIT_RE, claudeAuth } from './auth.ts'
import { claudeStream } from './claude-events.ts'
import { runClaudeSdk } from './claude-sdk.ts'
import { claudeEnv } from './claude-env.ts'
import { dirname } from 'node:path'
import { readOnlyBashRules, rtkBin, rtkSettings } from '../rtk.ts'

function versionOf(cmd: string, prefix: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(cmd, [...prefix, '--version'], { timeout: 15000, windowsHide: true }, (err, out) =>
      resolve(err ? undefined : out.trim().split('\n')[0])
    )
  })
}

const SCAN_SANDBOX = { sandbox: { enabled: true, autoAllowBashIfSandboxed: true } }

/** one `--settings` per run: the scan's sandbox and the RTK hook travel together */
export function runSettings(tools: RunOpts['tools'], rtk: string | null): string | null {
  const extra = tools === 'scan' ? SCAN_SANDBOX : undefined
  if (rtk) return rtkSettings(rtk, extra)
  return extra ? JSON.stringify(extra) : null
}

export const claudeAdapter: AgentAdapter = {
  id: 'claude',
  models: ['haiku', 'sonnet', 'opus', 'fable'],

  async detect() {
    const cli = resolveCli('claude')
    if (!cli) return { id: 'claude', name: 'Claude', installed: false, note: 'não instalado' }
    const version = await versionOf(cli.cmd, cli.prefix)
    return { id: 'claude', name: 'Claude', installed: true, version, note: 'Claude Code CLI, modo headless' }
  },

  run(opts: RunOpts, onEvent: (e: AgentEvent) => void): RunHandle {
    // threads (they may ask the user before a tool runs) and the kept-alive coordinator go through the Agent SDK
    if (opts.tools === 'work' || opts.keepAlive) return runClaudeSdk(opts, onEvent)
    const cli = resolveCli('claude')
    if (!cli) {
      onEvent({ kind: 'done', ok: false, text: '', error: 'Claude CLI não encontrado' })
      return { done: Promise.resolve(), cancel() {} }
    }
    const rtk = opts.tools === 'readonly' || opts.tools === 'scan' ? rtkBin() : null
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      // skip the user's global hooks/plugins: they bloat context and change the output style
      '--setting-sources',
      'project',
      // a scan runs claude-security's workflow and agents, so it keeps Claude Code's default tools
      ...(opts.tools === 'scan' ? [] : ['--tools', opts.tools === 'none' ? '' : 'Read,Grep,Glob,Bash,Skill,TaskCreate,TaskUpdate,TaskList,TodoWrite']),
      // do not load the user's MCP connectors in headless runs: noise and tokens
      '--strict-mcp-config'
    ]
    // Bash only for read-only commands (headless mode denies the rest), compressed by RTK when installed
    // Skill loads plugin skills (superpowers…) on demand; without it threads cannot use them
    if (opts.tools === 'readonly') args.push('--allowedTools', ['Skill', ...readOnlyBashRules(!!rtk)].join(','))
    const settings = runSettings(opts.tools, rtk)
    if (settings) args.push('--settings', settings)
    // scan: edits only inside its throwaway folder, every Bash call inside Claude Code's sandbox
    if (opts.tools === 'scan') args.push('--permission-mode', 'acceptEdits', '--allowedTools', 'Workflow,Read,Glob,Grep')
    if (opts.sessionId) args.push('--resume', opts.sessionId)
    if (opts.model) args.push('--model', opts.model)
    if (opts.effort) args.push('--effort', opts.effort)
    if (opts.schema) args.push('--json-schema', JSON.stringify(opts.schema))
    if (opts.autocompact) args.push('--autocompact', String(opts.autocompact))
    for (const dir of opts.plugins ?? []) args.push('--plugin-dir', dir)
    const atts = opts.attachments ?? []
    const prompt = opts.prompt + attachmentText(atts)
    // images and PDFs travel as content blocks, which only the stream-json input carries
    const blocks = atts.some((a) => a.kind === 'image' || a.kind === 'pdf')
    if (blocks) args.push('--input-format', 'stream-json')
    // threads may re-read an attachment by path
    if (opts.tools === 'readonly') for (const d of new Set(atts.map((a) => dirname(a.path)))) args.push('--add-dir', d)

    // the account is fixed for the whole run; a token account only changes this child's env
    const account = claudeAuth().pick()
    const env = claudeEnv(account.env)
    let finished = false
    const finish = (e: Extract<AgentEvent, { kind: 'done' }>) => {
      if (finished) return
      finished = true
      const limited = !e.ok && e.error !== 'cancelado' && (stream.rejected || LIMIT_RE.test(e.error ?? ''))
      onEvent({ ...e, limited, account: account.id })
    }
    const stream = claudeStream(onEvent, account.id)
    const run = spawnCli(cli, args, {
      cwd: opts.cwd,
      env,
      input: blocks ? claudeUserMessage(prompt, atts) : prompt,
      onLine: (line) => {
        let ev: any
        try {
          ev = JSON.parse(line)
        } catch {
          return
        }
        const done = stream.handle(ev)
        if (done) finish(done)
      }
    })

    return {
      cancel: run.cancel,
      done: run.done.then(({ code, stderr, cancelled }) => {
        if (cancelled) finish({ kind: 'done', ok: false, text: stream.lastText, error: 'cancelado' })
        else finish({ kind: 'done', ok: false, text: stream.lastText, error: stderr.trim() || `claude saiu com código ${code}` })
      })
    }
  }
}
