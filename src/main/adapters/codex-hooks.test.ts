import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { codexHooks, ECONOMIZER_FILES, findEconomizer, missingEconomizerFiles } from './codex-hooks.ts'

const HOOKS = {
  hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: '"${PLUGIN_ROOT}/te" a', commandWindows: 'python -c "a\\b"', timeout: 15 }] }],
    SessionEnd: [{ hooks: [{ type: 'command', command: 'end', timeout: 30 }] }]
  }
}

function plugin(skip: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'brandy-te-'))
  for (const f of ECONOMIZER_FILES) {
    if (skip.includes(f)) continue
    mkdirSync(dirname(join(root, f)), { recursive: true })
    writeFileSync(join(root, f), f === 'hooks/codex-hooks.json' ? JSON.stringify(HOOKS) : '')
  }
  return root
}

/** the `-c` values, checking that every one is preceded by its flag */
function values(args: string[]): string[] {
  for (let i = 0; i < args.length; i += 2) assert.equal(args[i], '-c')
  return args.filter((_, i) => i % 2)
}
const state = (args: string[]) => values(args).find((v) => v.startsWith('hooks.state='))!

test('darwin: the plugin hooks and their trust go on the command line, with PLUGIN_ROOT', () => {
  const root = plugin()
  const r = codexHooks({ pluginRoot: root, rtkBin: null, platform: 'darwin' })
  const v = values(r.args)
  assert.equal(v[0], 'hooks.SessionStart=[{ hooks = [{ type = "command", command = "\\"${PLUGIN_ROOT}/te\\" a", timeout = 15 }] }]')
  assert.deepEqual(r.env, { PLUGIN_ROOT: root })
  assert.ok(state(r.args).includes('"/<session-flags>/config.toml:session_start:0:0" = { trusted_hash = "sha256:'))
  assert.ok(state(r.args).includes('"/<session-flags>/config.toml:session_end:0:0"'))
  rmSync(root, { recursive: true })
})

// the hash algorithm of Codex 0.171: a real run with it executed the hook without any other trust
test('the trust hash is the one Codex computes for the same hook', () => {
  const r = codexHooks({ pluginRoot: null, rtkBin: '/opt/homebrew/bin/rtk', platform: 'darwin' })
  assert.deepEqual(values(r.args), [
    'hooks.PreToolUse=[{ matcher = "Bash", hooks = [{ type = "command", command = "\\"/opt/homebrew/bin/rtk\\" hook codex", timeout = 600 }] }]',
    'hooks.state={ "/<session-flags>/config.toml:pre_tool_use:0:0" = { trusted_hash = "sha256:b8658db5e8df57e2601b1f067f13bf5347152aff3550badbbdc2b3d19f654565" } }'
  ])
  assert.deepEqual(r.env, {})
})

test('win32: uses commandWindows, escapes backslashes and trusts the Windows form of the key', () => {
  const root = plugin()
  const r = codexHooks({ pluginRoot: root, rtkBin: 'C:\\rtk\\rtk.exe', platform: 'win32' })
  const v = values(r.args)
  assert.ok(v.some((x) => x.includes('command = "python -c \\"a\\\\b\\""')))
  assert.ok(v.some((x) => x.includes('command = "\\"C:\\\\rtk\\\\rtk.exe\\" hook codex"')))
  assert.ok(state(r.args).includes('"C:\\\\<session-flags>\\\\config.toml:session_start:0:0"'))
  rmSync(root, { recursive: true })
})

test('an incomplete or absent plugin injects nothing of its own; without RTK nothing at all', () => {
  const broken = plugin(['lib/tokeneconomizer/plugin/hook.py'])
  assert.deepEqual(missingEconomizerFiles(broken), ['lib/tokeneconomizer/plugin/hook.py'])
  for (const pluginRoot of [broken, null]) {
    assert.deepEqual(codexHooks({ pluginRoot, rtkBin: null, platform: 'darwin' }), { args: [], env: {} })
  }
  const rtkOnly = codexHooks({ pluginRoot: broken, rtkBin: '/rtk', platform: 'darwin' })
  assert.equal(values(rtkOnly.args).length, 2)
  rmSync(broken, { recursive: true })
})

test('the TokenEconomizer is found among the plugins of the run', () => {
  const root = plugin()
  assert.equal(findEconomizer(['/outro', root]), root)
  assert.equal(findEconomizer(['/outro']), null)
  assert.equal(findEconomizer(undefined), null)
  rmSync(root, { recursive: true })
})
