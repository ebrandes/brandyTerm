import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codexArgs } from './codex.ts'
import { setGatewayProvider } from './gateway-launch.ts'

const env = { ELECTRON_RUN_AS_NODE: '1', BRANDY_GATEWAY_SOCKET: '/s', BRANDY_GATEWAY_TOKEN: 'tok' }
const thread = { projectId: 'p', threadId: 't' }
const base = { cwd: '/w', prompt: 'x' }

test('codex work thread gets the gateway before the final -', () => {
  setGatewayProvider(() => ({ command: '/e', args: ['/g.js'], env }))
  const a = codexArgs({ ...base, tools: 'work', thread })
  assert.equal(a.at(-1), '-')
  const pairs = [
    'mcp_servers.brandy.command="/e"',
    'mcp_servers.brandy.args=["/g.js"]',
    'mcp_servers.brandy.env={ ELECTRON_RUN_AS_NODE = "1", BRANDY_GATEWAY_SOCKET = "/s", BRANDY_GATEWAY_TOKEN = "tok" }',
    'mcp_servers.brandy.tool_timeout_sec=960'
  ]
  for (const p of pairs) {
    const i = a.indexOf(p)
    assert.ok(i > 0 && i < a.length - 1, p)
    assert.equal(a[i - 1], '-c')
  }
})

test('codex escapes a Windows pipe path', () => {
  setGatewayProvider(() => ({ command: '/e', args: ['/g.js'], env: { ...env, BRANDY_GATEWAY_SOCKET: '\\\\.\\pipe\\x' } }))
  const a = codexArgs({ ...base, tools: 'work', thread })
  assert.ok(a.some((x) => x.includes('BRANDY_GATEWAY_SOCKET = "\\\\\\\\.\\\\pipe\\\\x"')))
})

test('codex non-work runs and runs without a thread never get the gateway', () => {
  setGatewayProvider(() => ({ command: '/e', args: ['/g.js'], env }))
  for (const o of [
    { ...base, tools: 'readonly' as const, thread },
    { ...base, tools: 'none' as const, thread },
    { ...base, tools: 'work' as const }
  ]) assert.equal(codexArgs(o).some((x) => x.includes('mcp_servers.brandy')), false)
})

test('hook arguments go before the final -, in new and resumed runs; without them nothing changes', () => {
  const hooks = ['-c', 'hooks.Stop=[]']
  for (const o of [{ ...base, tools: 'work' as const }, { ...base, tools: 'readonly' as const, sessionId: 's' }]) {
    const plain = codexArgs(o)
    assert.deepEqual(codexArgs(o, hooks), [...plain.slice(0, -1), ...hooks, '-'])
    assert.equal(plain.some((x) => x.startsWith('hooks.')), false)
  }
})
