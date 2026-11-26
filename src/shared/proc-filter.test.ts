import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attributeProcs, type ProcEntry } from './proc-attribution.ts'
import { isInfra } from './proc-filter.ts'

const APP = 100
const ROOT = '/Users/u/Projects/fix'
const ZSH = 200
const table: ProcEntry[] = [
  { pid: 50, ppid: 1, command: 'node /x/node_modules/.bin/electron-vite dev -w' },
  { pid: APP, ppid: 50, command: '/x/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .' },
  { pid: ZSH, ppid: APP, command: '-zsh' }
]
const check = (command: string, ppid = 1, extra: ProcEntry[] = []): boolean => {
  const entry = { pid: 999, ppid, command }
  return isInfra(entry, new Map([...table, ...extra, entry].map((p) => [p.pid, p])), APP, new Set([ZSH]))
}

test('hides agents, wherever they run', () => {
  for (const c of [
    'claude', '/opt/homebrew/bin/claude --resume', 'node /usr/local/bin/codex', 'codex exec --json', 'C:\\bin\\claude.exe -p',
    'node /x/node_modules/@anthropic-ai/claude-code/cli.js', 'node /x/node_modules/@anthropic-ai/claude-agent-sdk/cli.js',
    '/Users/u/.local/share/claude/versions/2.1.0', 'node /x/node_modules/@openai/codex/bin/codex.js'
  ]) assert.equal(check(c, ZSH), true, c)
})

test('hides the app, electron and their helpers', () => {
  for (const c of [
    '/Applications/BrandyTerm.app/Contents/MacOS/BrandyTerm', 'BrandyTerm Helper (GPU) --type=gpu-process', 'electron .',
    '/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper --type=utility',
    'node /x/node_modules/.bin/electron-vite dev -w', 'C:\\x\\electron.exe --type=renderer'
  ]) assert.equal(check(c, ZSH), true, c)
})

test('hides MCP servers and hooks', () => {
  for (const c of [
    'node /opt/homebrew/bin/codegraph serve --mcp', 'npm exec chrome-devtools-mcp@latest', 'npx -y @modelcontextprotocol/server-memory',
    'node /x/node_modules/@playwright/mcp/cli.js', 'uvx mcp-server-git', 'node /x/node_modules/some-mcp/dist/index.js',
    'npx mcp-remote https://x', 'cmd /c npx @upstash/context7-mcp', 'python3 /x/tokeneconomizer/scripts/hook.py', 'rtk proxy'
  ]) assert.equal(check(c, ZSH), true, c)
})

test('hides what the app or an agent starts without a shell, and anything under an MCP wrapper', () => {
  assert.equal(check('node helper.js', APP), true)
  assert.equal(check('node server.js', 300, [{ pid: 300, ppid: APP, command: 'claude -p' }]), true)
  assert.equal(check('node server.js', 300, [{ pid: 300, ppid: 1, command: 'npm exec foo-mcp' }]), true)
})

test('keeps dev servers, also the ones a thread starts through a shell', () => {
  const claude = { pid: 300, ppid: APP, command: 'claude -p' }
  assert.equal(check('node /p/node_modules/astro/bin/astro.mjs preview --port 4321'), false)
  assert.equal(check('http-server', ZSH), false)
  assert.equal(check('node server.js', 301, [claude, { pid: 301, ppid: 300, command: '/bin/zsh -c npm run dev' }]), false)
  assert.equal(check('npm run dev', 300, [claude]), false)
  assert.equal(check('node /Users/u/Projects/app-mcp/node_modules/vite/bin/vite.js', ZSH), false)
  assert.equal(check('node /Users/u/Projects/brandyTerm/server.js', ZSH), false)
})

test('the app and its ancestors are always hidden', () => {
  const byPid = new Map(table.map((p) => [p.pid, p]))
  for (const pid of [APP, 50]) assert.equal(isInfra(byPid.get(pid)!, byPid, APP, new Set()), true)
})

test('attributeProcs applies the filter: claude in the terminal and MCP in the folder are not listed', () => {
  const procs: ProcEntry[] = [
    ...table,
    { pid: 400, ppid: ZSH, command: 'claude', pgid: 400, tpgid: 400 },
    { pid: 401, ppid: 1, command: 'node /opt/homebrew/bin/codegraph serve --mcp', cwd: ROOT },
    { pid: 402, ppid: 1, command: 'codex', cwd: ROOT },
    { pid: 403, ppid: 1, command: 'http-server', cwd: ROOT, startedAt: 5 }
  ]
  const found = attributeProcs(
    { procs, ports: new Map([[401, [1]], [402, [2]], [403, [3]]]) },
    [{ projectId: 'fix', path: ROOT }], { terminals: new Map([['fix', ZSH]]), managed: [] }, APP, 'darwin'
  )
  assert.deepEqual(found, [{ pid: 403, projectId: 'fix', origin: 'external', command: 'http-server', ports: [3], cwd: ROOT, folder: '', startedAt: 5 }])
})
