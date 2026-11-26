import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexRtkHook, economizerCoverage, rtkCoverage } from './tool-health.ts'

const group = (command: string) => ({ hooks: [{ type: 'command', command }] })

function codexHome(toml: (hooksFile: string) => string) {
  const dir = mkdtempSync(join(tmpdir(), 'brandy-codex-'))
  const file = join(dir, 'hooks.json')
  writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [group('node notify.js'), group('rtk hook codex')] } }))
  writeFileSync(join(dir, 'config.toml'), toml(file.replaceAll('\\', '\\\\')))
  return dir
}

test('the RTK hook counts as approved only with a trust record at its own position', () => {
  const other = codexHome((f) => `[hooks.state."${f}:pre_tool_use:0:0"]\ntrusted_hash = "sha256:a"\n`)
  assert.equal(codexRtkHook(other), 'unapproved')
  const own = codexHome((f) => `[hooks.state."${f}:pre_tool_use:1:0"]\ntrusted_hash = "sha256:a"\n\n[x]\n`)
  assert.equal(codexRtkHook(own), 'approved')
  const off = codexHome((f) => `[hooks.state."${f}:pre_tool_use:1:0"]\ntrusted_hash = "sha256:a"\nenabled = false\n`)
  assert.equal(codexRtkHook(off), 'unapproved')
  for (const d of [other, own, off]) rmSync(d, { recursive: true })
})

test('no hooks file means no RTK in Codex', () => {
  assert.equal(codexRtkHook('/nao/existe'), 'missing')
})

test('coverage lists Codex only when it is installed', () => {
  assert.deepEqual(rtkCoverage(true, null).map((c) => c.agent), ['claude'])
  assert.deepEqual(rtkCoverage(true, 'unapproved').map((c) => c.ok), [true, false])
  assert.deepEqual(economizerCoverage([], true).map((c) => c.ok), [true, false])
  assert.equal(economizerCoverage(['lib/hook.py'], false)[0].ok, false)
})
