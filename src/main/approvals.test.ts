import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ThreadApprovals } from './approvals.ts'
import type { ApprovalAsk } from './adapters/types.ts'
import type { ApprovalDecision, Thread } from '../shared/types.ts'

const thread = (): Thread => ({ id: 't1', steps: [] }) as unknown as Thread
const bash = (command: string): ApprovalAsk => ({ tool: 'Bash', input: { command }, summary: command, signal: new AbortController().signal })
const conn = (tool: string, id = 'railway'): ApprovalAsk => ({
  tool: `mcp__${id}__${tool}`,
  input: {},
  summary: `Railway · ${tool}`,
  detail: '{"a":1}',
  connector: { id, name: 'Railway', tool },
  signal: new AbortController().signal
})

/** true while the promise has not resolved */
async function pending(p: Promise<unknown>): Promise<boolean> {
  return (await Promise.race([p.then(() => false), new Promise<boolean>((r) => setImmediate(() => r(true)))]))
}

test('allowAll does not cover connector asks', async () => {
  const t = thread()
  t.allowAll = true
  const ap = new ThreadApprovals(() => {})
  const p = ap.ask(t, conn('get_logs'))
  assert.equal(await pending(p), true)
  assert.deepEqual(t.approval?.connector, { name: 'Railway', tool: 'get_logs' })
  assert.equal(t.approval?.summary, 'Railway · get_logs')
  assert.equal(await ap.ask(t, bash('npm test')), 'allow')
})

test('"all" answer leaves a connector card pending and resolves the rest', async () => {
  const t = thread()
  const ap = new ThreadApprovals(() => {})
  const first = ap.ask(t, bash('npm test'))
  const c = ap.ask(t, conn('get_logs'))
  const other = ap.ask(t, bash('git commit'))
  ap.respond(t, t.approval!.id, 'all')
  assert.equal(await first, 'all')
  assert.equal(await other, 'allow')
  assert.equal(await pending(c), true)
  assert.equal(t.allowAll, true)
  assert.equal(t.approval?.connector?.tool, 'get_logs')
})

test('always in thread covers the same connector tool only', async () => {
  const t = thread()
  const ap = new ThreadApprovals(() => {})
  const p = ap.ask(t, conn('get_logs'))
  ap.respond(t, t.approval!.id, 'always')
  assert.equal(await p, 'always')
  assert.deepEqual(t.allow, ['Conector:railway:get_logs'])
  assert.equal(await ap.ask(t, conn('get_logs')), 'allow')
  const d = ap.ask(t, conn('deploy'))
  assert.equal(await pending(d), true)
  assert.equal(t.approval?.connector?.tool, 'deploy')
  assert.equal(t.approval?.always, 'Sempre nesta thread')
})

test('forever resolves forever and does not add a thread rule', async () => {
  const t = thread()
  const ap = new ThreadApprovals(() => {})
  const p = ap.ask(t, conn('get_logs'))
  ap.respond(t, t.approval!.id, 'forever')
  assert.equal(await p, 'forever')
  assert.equal(t.allow, undefined)
})

test('forever on a non-connector card acts as always', async () => {
  const t = thread()
  const ap = new ThreadApprovals(() => {})
  const p = ap.ask(t, bash('npm test'))
  ap.respond(t, t.approval!.id, 'forever')
  const d: ApprovalDecision = await p
  assert.equal(d, 'always')
  assert.deepEqual(t.allow, ['Bash:npm test'])
})

test('"all" answered on a connector card keeps that card and sets allowAll', async () => {
  const t = thread()
  const ap = new ThreadApprovals(() => {})
  const c = ap.ask(t, conn('get_logs'))
  const b = ap.ask(t, bash('npm test'))
  ap.respond(t, t.approval!.id, 'all')
  assert.equal(await b, 'allow')
  assert.equal(await pending(c), true)
  assert.equal(t.allowAll, true)
  assert.equal(t.approval?.connector?.tool, 'get_logs')
})
