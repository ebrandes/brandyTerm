import { test } from 'node:test'
import assert from 'node:assert/strict'
import { killPidTree } from './proc.ts'

test('on Windows the whole process tree goes: taskkill /T /F, so an npx child does not outlive cmd.exe', () => {
  const ran: [string, string[]][] = []
  killPidTree(4321, 'win32', (cmd, args) => { ran.push([cmd, args]) })
  assert.deepEqual(ran, [['taskkill', ['/pid', '4321', '/T', '/F']]])
})

test('on macOS and Linux the pid gets the plain signal it got before', () => {
  const sent: [number, unknown][] = []
  const kill = process.kill
  process.kill = ((pid: number, sig?: unknown) => { sent.push([pid, sig]); return true }) as typeof process.kill
  try {
    killPidTree(4321, 'darwin', () => { throw new Error('taskkill only on Windows') })
  } finally {
    process.kill = kill
  }
  assert.deepEqual(sent, [[4321, undefined]])
})
