import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stopHint, stopQuestion } from './proc-stop-labels.ts'

test('the confirmation names the process, pid and ports', () => {
  assert.equal(stopQuestion('Astro preview', 17948, [4321]), 'Parar Astro preview (PID 17948, :4321)?')
  assert.equal(stopQuestion('tsc watch', 5, []), 'Parar tsc watch (PID 5)?')
  assert.equal(stopQuestion('web', undefined, []), 'Parar web?')
})

test('the hint says how each platform stops', () => {
  assert.match(stopHint('win32'), /taskkill \/T.*\/F/)
  for (const p of ['darwin', 'linux']) assert.match(stopHint(p), /SIGTERM.*SIGKILL/)
  assert.doesNotMatch(stopHint(undefined), /SIG|taskkill/)
})
