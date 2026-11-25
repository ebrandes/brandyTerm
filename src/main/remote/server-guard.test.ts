import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FileBytes } from '../../shared/remote/files.ts'
import type { FsEntry } from '../../shared/types.ts'
import { readArtifact } from '../artifact-read.ts'
import { readGuard } from './read-guard.ts'
import { remoteCalls } from './remote-calls.ts'
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

test('a path sent as an array (or any non-string) is refused before the real handlers coerce it', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'srv-guard-')))
  const root = join(base, 'Projects')
  const ud = join(root, 'ud')
  mkdirSync(join(root, 'vivo'), { recursive: true })
  mkdirSync(ud)
  writeFileSync(join(root, 'vivo', 'secret.md'), 'segredo')
  writeFileSync(join(ud, 'remote-key.json'), '{"secret":"k"}')
  writeFileSync(join(root, '.env'), 'K=1')
  writeFileSync(join(root, 'ok.md'), 'ok')
  const att = join(base, 'att')
  const rootOf = (id: string): string | null => (id === 'vis' ? root : null)
  const calls = remoteCalls({
    engine: { addProject: () => 'x' }, attachmentsRoot: () => att, rootOf, userData: () => ud, hiddenRoots: () => []
  })
  const guard = readGuard({ userData: () => ud, attachmentsRoot: () => att })
  try {
    await withHost(async e => {
      e.state.projects = [proj('vis', { path: root }), proj('hid', { path: join(root, 'vivo'), remoteHidden: true })]
      e.reg.add('artifact:bytes', a => calls.artifactBytes(a), 'pass')
      e.reg.add('attach:read', a => calls.attachRead(a), 'pass')
      // the coercion of artifact-ipc.ts (which needs Electron)
      e.reg.add('artifact:read', a => readArtifact(rootOf(String(a?.projectId)) ?? '', String(a?.path ?? '')), 'pass')
      const ch = await e.connect()
      const ok = await ch.request('artifact:bytes', { projectId: 'vis', path: 'ok.md' }) as FileBytes
      assert.equal(new TextDecoder().decode(ok.data), 'ok')
      for (const channel of ['artifact:bytes', 'artifact:read', 'attach:read']) {
        for (const path of [['vivo/secret.md'], ['ud/remote-key.json'], ['.env'], { 0: '.env' }, 1]) {
          const sent = ch.request(channel, { projectId: 'vis', path })
          await assert.rejects(sent, /^Error: Pasta não permitida$/, `${channel} ${JSON.stringify(path)}`)
        }
      }
      const files = new Set(['artifact:bytes', 'artifact:read', 'attach:read'])
      assert.equal(e.calls.filter(c => files.has(c.channel)).length, 1, 'only the string call reached a handler')
      ch.close()
    }, { guard })
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
