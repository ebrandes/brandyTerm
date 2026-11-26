import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runSettings } from './adapters/claude.ts'

test('the scan keeps its sandbox and gets the RTK hook in the same settings', () => {
  const scan = JSON.parse(runSettings('scan', '/bin/rtk')!)
  assert.equal(scan.sandbox.enabled, true)
  assert.equal(scan.hooks.PreToolUse[0].hooks[0].command, '"/bin/rtk" hook claude')
  assert.equal(JSON.parse(runSettings('scan', null)!).sandbox.enabled, true)
})

test('read-only runs get only the hook, work runs get no extra settings', () => {
  assert.equal(JSON.parse(runSettings('readonly', '/bin/rtk')!).sandbox, undefined)
  assert.equal(runSettings('work', null), null)
})
