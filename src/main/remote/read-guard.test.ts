import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppState, FsEntry, Project } from '../../shared/types.ts'
import { browseDir } from '../fs-browse.ts'
import { readGuard } from './read-guard.ts'

const HIDDEN = /^Error: Projeto não disponível remotamente$/
const FORBIDDEN = /^Error: Pasta não permitida$/

/**
 * proj/ is visible and holds: a hidden project (vivo/), the app's data (ud/), dot entries and a link to vivo/.
 * att/vis/ is the visible project's attachments folder, with the same three kinds of protected entries.
 */
function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'rg-')))
  const proj = join(base, 'proj')
  const files: Record<string, string> = {
    'src/a.md': '# oi', 'vivo/secret.md': 'segredo', 'ud/remote-key.json': '{}', '.env': 'K=1', '.git/config': 'x'
  }
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(proj, rel, '..'), { recursive: true })
    writeFileSync(join(proj, rel), text)
  }
  symlinkSync(join(proj, 'vivo'), join(proj, 'link'))
  const att = join(base, 'att')
  for (const d of ['vis/h', 'vis/u']) mkdirSync(join(att, d), { recursive: true })
  for (const f of ['vis/ok.png', 'vis/h/x.png', 'vis/u/k.json', 'vis/.x.png']) writeFileSync(join(att, f), 'x')
  const projects = [
    { id: 'vis', name: 'vis', path: proj },
    { id: 'hid', name: 'hid', path: join(proj, 'vivo'), remoteHidden: true },
    { id: 'hid2', name: 'hid2', path: join(att, 'vis', 'h'), remoteHidden: true }
  ] as Project[]
  const state = { projects, agents: [], plugins: [] } as unknown as AppState
  const guard = readGuard({ userData: () => join(proj, 'ud'), attachmentsRoot: () => att, home: () => base })
  return { base, proj, att, state, guard }
}

for (const channel of ['artifact:read', 'artifact:bytes']) {
  test(`${channel}: nested hidden project, userData inside the project and dot entries are refused`, () => {
    const { state, guard } = setup()
    const call = (path: string) => () => guard.before(channel, { projectId: 'vis', path }, state)
    assert.doesNotThrow(call('src/a.md'))
    assert.doesNotThrow(call('src/missing.md')) // the handler answers "não encontrado"
    assert.throws(call('vivo/secret.md'), HIDDEN)
    assert.throws(call('link/secret.md'), HIDDEN) // a link into the hidden project
    assert.throws(call('src/../vivo/secret.md'), HIDDEN)
    assert.throws(call('ud/remote-key.json'), FORBIDDEN)
    assert.throws(call('.env'), FORBIDDEN)
    assert.throws(call('.git/config'), FORBIDDEN)
  })
}

test('attach:read: hidden folder, userData and dot file inside the attachments folder are refused', () => {
  const { att, state, guard } = setup()
  const strict = readGuard({ userData: () => join(att, 'vis', 'u'), attachmentsRoot: () => att })
  const call = (g: typeof guard, file: string) => () => g.before('attach:read', { projectId: 'vis', path: join(att, file) }, state)
  assert.doesNotThrow(call(guard, 'vis/ok.png'))
  assert.throws(call(guard, 'vis/h/x.png'), HIDDEN)
  assert.throws(call(strict, 'vis/u/k.json'), FORBIDDEN)
  assert.throws(call(guard, 'vis/.x.png'), FORBIDDEN)
})

test('attach:read: the real layout (attachments inside userData) still reads the project attachments', () => {
  const { att, state } = setup()
  const g = readGuard({ userData: () => att, attachmentsRoot: () => att })
  assert.doesNotThrow(() => g.before('attach:read', { projectId: 'vis', path: join(att, 'vis', 'ok.png') }, state))
})

test('fs:list: entries in a nested hidden project, userData or a dot folder are left out', () => {
  const { state, guard } = setup()
  const listed: FsEntry[] = [
    'src/', 'src/a.md', 'vivo/', 'vivo/secret.md', 'link/', 'link/secret.md', 'ud/', 'ud/remote-key.json', '.env', '.git/config'
  ].map(path => ({ path, kind: path.endsWith('/') ? 'dir' : 'file' }))
  const out = guard.after('fs:list', { projectId: 'vis', query: 'vivo/' }, listed, state) as FsEntry[]
  assert.deepEqual(out.map(e => e.path), ['src/', 'src/a.md'])
  assert.equal(guard.after('fs:list', { projectId: 'vis', query: '' }, 'x', state), 'x')
})

test('fs:browse: hidden, userData and dot folders are not listed and cannot be entered', async () => {
  const { proj, state, guard } = setup()
  const q = `${proj}/`
  const raw = (await browseDir(q)).filter(e => e.kind === 'dir')
  assert.ok(raw.some(e => e.path === `${q}vivo/`) && raw.some(e => e.path === `${q}ud/`))
  const out = guard.after('fs:browse', q, raw, state) as FsEntry[]
  assert.deepEqual(out.map(e => e.path), [`${q}src/`])
  const dots = guard.after('fs:browse', `${q}.`, await browseDir(`${q}.`), state) as FsEntry[]
  assert.deepEqual(dots, [])
  assert.doesNotThrow(() => guard.before('fs:browse', q, state))
  assert.doesNotThrow(() => guard.before('fs:browse', '~/', state))
  assert.throws(() => guard.before('fs:browse', `${q}vivo/`, state), HIDDEN)
  assert.throws(() => guard.before('fs:browse', `${q}link/`, state), HIDDEN)
  assert.throws(() => guard.before('fs:browse', `${q}ud/`, state), FORBIDDEN)
  assert.throws(() => guard.before('fs:browse', `${q}.git/`, state), FORBIDDEN)
})

test('calls that name no file are left alone', () => {
  const { state, guard } = setup()
  assert.doesNotThrow(() => guard.before('chat:send', { projectId: 'vis', text: 'oi' }, state))
  assert.doesNotThrow(() => guard.before('state:get', undefined, state))
  assert.deepEqual(guard.after('archive:list', ['vis'], [1], state), [1])
})

// The handlers turn any value into a path with String(): ['vivo/secret.md'] would read vivo/secret.md.
const NOT_STRINGS: unknown[] = [['vivo/secret.md'], [['ud', 'remote-key.json']], ['.env'], { p: '.env' }, 7, null, true]

for (const channel of ['artifact:read', 'artifact:bytes', 'artifact:open', 'attach:read']) {
  test(`${channel}: a path that is not a string is refused, never turned into one`, () => {
    const { att, state, guard } = setup()
    for (const path of NOT_STRINGS) {
      // attach:read takes an absolute path: the array names the hidden folder's file inside the attachments
      const p = channel === 'attach:read' && Array.isArray(path) ? [join(att, 'vis', 'h', 'x.png')] : path
      assert.throws(() => guard.before(channel, { projectId: 'vis', path: p }, state), FORBIDDEN, JSON.stringify(p))
    }
    const ok = channel === 'attach:read' ? join(att, 'vis', 'ok.png') : 'src/a.md'
    assert.doesNotThrow(() => guard.before(channel, { projectId: 'vis', path: ok }, state))
  })
}

test('fs:list: a query that is not a string is refused', () => {
  const { state, guard } = setup()
  for (const query of [['/etc'], ['..'], { q: '~' }, 3, null]) {
    assert.throws(() => guard.before('fs:list', { projectId: 'vis', query }, state), FORBIDDEN, JSON.stringify(query))
  }
  assert.doesNotThrow(() => guard.before('fs:list', { projectId: 'vis', query: 'src/' }, state))
  assert.doesNotThrow(() => guard.before('fs:list', { projectId: 'vis' }, state))
})

test('fs:browse: a folder that is not a string is refused; no folder means home', () => {
  const { proj, state, guard } = setup()
  for (const arg of [[`${proj}/vivo/`], [`${proj}/`], { dir: proj }, 5, null]) {
    assert.throws(() => guard.before('fs:browse', arg, state), FORBIDDEN, JSON.stringify(arg))
  }
  assert.doesNotThrow(() => guard.before('fs:browse', undefined, state))
})
