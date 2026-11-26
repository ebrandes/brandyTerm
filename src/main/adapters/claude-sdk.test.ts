import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import { buildOptions } from './claude-sdk.ts'
import { setGatewayProvider } from './gateway-launch.ts'

const env = { ELECTRON_RUN_AS_NODE: '1', BRANDY_GATEWAY_SOCKET: '/s', BRANDY_GATEWAY_TOKEN: 'tok' }
setGatewayProvider(() => ({ command: '/e', args: ['/g.js'], env }))
const canUse: CanUseTool = async () => ({ behavior: 'deny', message: 'x' })
const thread = { projectId: 'p', threadId: 't' }

test('claude work thread gets brandy', () => {
  const o = buildOptions({ cwd: '/w', prompt: 'x', tools: 'work', thread }, {}, canUse)
  assert.equal(o.strictMcpConfig, true)
  // always loaded (never deferred behind tool search, there on turn 1) and allowed as long as the agent's own timeout
  assert.deepEqual(o.mcpServers?.brandy, { type: 'stdio', command: '/e', args: ['/g.js'], env, alwaysLoad: true, timeout: 960000 })
  for (const n of ['list_connectors', 'connector_tools', 'call_connector', 'app_status', 'queue_apply']) assert.ok(o.allowedTools?.includes(`mcp__brandy__${n}`))
  assert.equal(o.env?.MCP_TOOL_TIMEOUT, '960000')
})

test('claude work thread without a thread ref gets no gateway', () => {
  const o = buildOptions({ cwd: '/w', prompt: 'x', tools: 'work' }, {}, canUse)
  assert.equal(o.mcpServers, undefined)
  assert.equal(o.env?.MCP_TOOL_TIMEOUT, undefined)
})

test('claude non-work runs have no mcpServers', () => {
  for (const tools of ['readonly', 'none', 'scan'] as const) {
    const o = buildOptions({ cwd: '/w', prompt: 'x', tools, thread }, {}, canUse)
    assert.equal('mcpServers' in o, false, tools)
    assert.equal(o.allowedTools?.some((t) => t.startsWith('mcp__brandy__')), false)
  }
})
