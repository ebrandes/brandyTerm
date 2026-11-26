import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { registry } from './rpc/registry.ts'
import { ruleOf } from './rpc/channels.ts'
import { claudeAdapter } from './adapters/claude.ts'
import { runOnce } from './run.ts'
import { diagLogDir, flushDiagLog } from './diag-log.ts'
import { logArea, readLogs } from './logs-read.ts'
import { createSummarizer, type ModelRun } from './logs-summary.ts'

const logsDir = (): string => diagLogDir() ?? app.getPath('logs')

function askHaiku(prompt: string): ModelRun {
  const dir = logsDir()
  mkdirSync(dir, { recursive: true })
  const { handle, result } = runOnce(claudeAdapter, {
    // the CLI reads project settings from its cwd: the logs folder has none
    cwd: dir,
    prompt,
    model: 'haiku',
    effort: 'low',
    tools: 'none',
    tag: { kind: 'other' }
  })
  return {
    cancel: () => handle.cancel(),
    result: result.then((r) => ({
      ok: !!r.done?.ok,
      text: r.done?.text ?? '',
      error: r.done?.error,
      costUsd: r.usage.costUsd || undefined
    }))
  }
}

/** The "Ver logs" modal: the entries, and the summary asked only while it is open. */
export function registerLogsIpc(): void {
  const read = async (area: string) => {
    await flushDiagLog()
    return readLogs(logsDir(), area)
  }
  const summarizer = createSummarizer({ read, run: askHaiku })
  registry.add('logs:read', (area: unknown) => read(logArea(area)), ruleOf('logs:read'))
  registry.add('logs:summarize', (area: unknown) => summarizer.summarize(logArea(area)), ruleOf('logs:summarize'))
  registry.add('logs:summarize-cancel', (area: unknown) => summarizer.cancel(logArea(area)), ruleOf('logs:summarize-cancel'))
}
