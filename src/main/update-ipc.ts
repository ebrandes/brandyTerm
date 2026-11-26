// Update checks while the app runs: at startup and every 6 hours, without a token. It only reads and
// tells: nothing is downloaded or installed.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, net, shell, type BrowserWindow } from 'electron'
import { diagLog } from './diag-log.ts'
import { checkForUpdate, LATEST_RELEASE_API, type CheckDeps } from './update-check.ts'
import { createUpdateMonitor } from './update-monitor.ts'
import { registry } from './rpc/registry.ts'
import { ruleOf } from './rpc/channels.ts'

const EVERY_MS = 6 * 60 * 60 * 1000
const TIMEOUT_MS = 15_000

/** git that never stops to ask for a password and never starts maintenance */
function gitIn(root: string): NonNullable<CheckDeps['git']> {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -oBatchMode=yes'
  }
  return (args) => new Promise((resolve, reject) => {
    execFile('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args],
      { cwd: root, env, timeout: TIMEOUT_MS, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout.trim())))
  })
}

// net.fetch follows the system's proxy settings
async function fetchLatest(): ReturnType<CheckDeps['fetchLatest']> {
  const res = await net.fetch(LATEST_RELEASE_API, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'BrandyTerm' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  return { status: res.status, body: res.ok ? await res.json() : null }
}

export function registerUpdateIpc(getWin: () => BrowserWindow | null): void {
  const root = app.getAppPath()
  const git = !app.isPackaged && existsSync(join(root, '.git')) ? gitIn(root) : undefined
  const version = app.getVersion()
  const monitor = createUpdateMonitor(
    version,
    () => checkForUpdate({ version, fetchLatest, git, log: (level, msg, data) => diagLog('update', level, msg, data) }),
    (status) => getWin()?.webContents.send('update:status', status)
  )
  registry.add('update:get', () => monitor.status(), ruleOf('update:get'))
  registry.add('update:open-release', () => {
    // the address comes from the last check, never from the caller
    const notice = monitor.status().update
    if (notice?.kind === 'release') void shell.openExternal(notice.url)
  }, ruleOf('update:open-release'))
  void monitor.check()
  const timer = setInterval(() => void monitor.check(), EVERY_MS)
  app.once('before-quit', () => clearInterval(timer))
}
