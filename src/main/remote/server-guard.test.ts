import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FsEntry } from '../../shared/types.ts'
import { readGuard } from './read-guard.ts'
import { proj, withHost } from './server-rig.ts'

test('remote file calls go through the read guard: a nested hidden project stays unreadable', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'srv-guard-')))
  const root = join(base, 'Projects')
  mkdirSync(join(root, 'vivo'), { recursive: true })
  writeFileSync(join(root, 'vivo', 'secret.md'), 'segredo')
  writeFileSync(join(root, 'ok.md'), 'ok')
  const guard = readGuard({ userData: () => join(base, 'ud'), attachmentsRoot: () => join(base, 'att') })
  try {
    await withHost(async e => {
      e.state.projects = [proj('vis', { path: root }), proj('hid', { path: join(root, 'vivo'), remoteHidden: true })]
      e.reg.add('artifact:bytes', a => `bytes:${a.path}`, 'pass')
      e.reg.add('fs:browse', () => [{ path: `${root}/vivo/`, kind: 'dir' }, { path: `${root}/src/`, kind: 'dir' }], 'pass')
      const ch = await e.connect()
      assert.equal(await ch.request('artifact:bytes', { projectId: 'vis', path: 'ok.md' }), 'bytes:ok.md')
      const secret = ch.request('artifact:bytes', { projectId: 'vis', path: 'vivo/secret.md' })
      await assert.rejects(secret, /^Error: Projeto não disponível remotamente$/)
      assert.equal(e.calls.filter(c => c.channel === 'artifact:bytes').length, 1, 'the refused call never reached the handler')
      const listed = await ch.request('fs:browse', `${root}/`) as FsEntry[]
      assert.deepEqual(listed.map(x => x.path), [`${root}/src/`])
      ch.close()
    }, { guard })
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
