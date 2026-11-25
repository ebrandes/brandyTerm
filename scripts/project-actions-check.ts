// Checks the sidebar's per-project actions (pure part): node scripts/project-actions-check.ts
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import type { Message, Project, Thread } from '../src/shared/types.ts'
import {
  NAME_MAX, busyReason, canRemove, cleanName, clearCoordinatorContext, forgetProjectData, renameProject, setProjectArchived
} from '../src/main/project-actions.ts'
import { readArchive } from '../src/main/archive.ts'
import { rotateSession } from '../src/main/coordinator-memory.ts'

const zero = () => ({ input: 0, output: 0, cached: 0, measured: false })
const AT = '2026-11-25T12:00:00.000Z'

function thread(id: string, state: Thread['state']): Thread {
  return {
    id, requestId: `r-${id}`, title: id, objective: id, agent: 'claude', effort: 'medium', state,
    todos: [], steps: [], messages: [], usage: zero(), createdAt: AT, updatedAt: AT
  }
}

function project(id: string, path: string, threads: Thread[] = []): Project {
  return {
    id, name: id, path, demo: false, messages: [], threads, busy: false, synthesized: [], processes: [],
    coordinator: { agent: 'claude', sessionId: 'old-session', usage: zero(), turns: 7, context: { used: 150_000, limit: 300_000 } }
  }
}

const note = (): Message => ({ id: 'n', author: 'system', time: AT, text: 'Contexto do coordenador limpo.' })

let ok = 0
const check = (name: string, fn: () => void) => {
  fn()
  ok++
  console.log('ok -', name)
}

check('cleanName trims, collapses spaces, caps the length and rejects empty or non-text', () => {
  assert.equal(cleanName('  Meu   projeto \n'), 'Meu projeto')
  assert.equal(cleanName(''), null)
  assert.equal(cleanName('   \t '), null)
  assert.equal(cleanName(42), null)
  assert.equal(cleanName(undefined), null)
  assert.equal(cleanName('x'.repeat(200))?.length, NAME_MAX)
})

check('rename changes only the display name, never the path', () => {
  const p = project('a', '/Users/x/pasta-original')
  assert.deepEqual(renameProject(p, '  Novo nome  '), { ok: true })
  assert.equal(p.name, 'Novo nome')
  assert.equal(p.path, '/Users/x/pasta-original')
  const r = renameProject(p, '   ')
  assert.equal(r.ok, false)
  assert.match(r.error!, /vazio/)
  assert.equal(p.name, 'Novo nome', 'an empty name is refused and the old one stays')
})

check('archive sets archivedAt once; restore clears it', () => {
  const p = project('a', '/tmp/a')
  setProjectArchived(p, true, new Date(AT))
  assert.equal(p.archivedAt, AT)
  setProjectArchived(p, true, new Date('2030-01-01T00:00:00Z'))
  assert.equal(p.archivedAt, AT, 'archiving twice keeps the first date')
  setProjectArchived(p, false)
  assert.equal(p.archivedAt, undefined)
  assert.equal(p.path, '/tmp/a')
})

check('busyReason: queued, running and waiting threads or a coordinator call block; finished ones do not', () => {
  assert.equal(busyReason(project('a', '/t', [thread('1', 'done'), thread('2', 'failed'), thread('3', 'cancelled')])), null)
  assert.match(busyReason(project('a', '/t', [thread('1', 'running')]))!, /1 thread em execução/)
  assert.match(busyReason(project('a', '/t', [thread('1', 'queued'), thread('2', 'waiting')]))!, /2 threads em execução/)
  assert.match(busyReason({ ...project('a', '/t'), busy: true })!, /coordenador está respondendo/)
})

check('clear context: drops the session and the context counter, keeps chat, threads and usage', () => {
  const p = project('a', '/t', [thread('1', 'done')])
  p.messages.push({ id: 'm1', author: 'user', time: AT, text: 'oi' })
  p.coordinator.usage.input = 999
  assert.deepEqual(clearCoordinatorContext(p, note()), { ok: true })
  assert.equal(p.coordinator.sessionId, undefined)
  assert.equal(p.coordinator.turns, 0)
  assert.deepEqual(p.coordinator.context, { used: 0, limit: 300_000 })
  assert.equal(p.coordinator.usage.input, 999, 'spent tokens are history, not context')
  assert.equal(p.threads.length, 1)
  assert.deepEqual(p.messages.map((m) => m.author), ['user', 'system'])
  // the next coordinator call starts fresh, through the same rotation path
  assert.equal(rotateSession(p), true)
  assert.equal(p.coordinator.turns, 1)
})

check('clear context is refused while threads run, and changes nothing', () => {
  const p = project('a', '/t', [thread('1', 'running')])
  const r = clearCoordinatorContext(p, note())
  assert.equal(r.ok, false)
  assert.equal(p.coordinator.sessionId, 'old-session')
  assert.equal(p.messages.length, 0)
})

check('remove: refused while threads run; allowed when idle', () => {
  assert.equal(canRemove(project('a', '/t', [thread('1', 'waiting')])).ok, false)
  assert.equal(canRemove(project('a', '/t', [thread('1', 'done')])).ok, true)
})

check('remove: deletes only that archive file and that lastSeen entry; the project folder is untouched', () => {
  const root = mkdtempSync(join(tmpdir(), 'brandy-actions-'))
  try {
    const dir = join(root, 'archive')
    const folder = join(root, 'meu-projeto')
    mkdirSync(dir)
    mkdirSync(folder)
    writeFileSync(join(folder, 'arquivo.txt'), 'do usuário')
    const file = (id: string) => JSON.stringify({ version: 1, projectId: id, projectName: id, threads: [thread(`t-${id}`, 'done')] })
    writeFileSync(join(dir, 'proj-a.json'), file('proj-a'))
    writeFileSync(join(dir, 'proj-b.json'), file('proj-b'))
    const lastSeen = forgetProjectData(dir, { 'proj-a': AT, 'proj-b': AT }, 'proj-a')
    assert.deepEqual(lastSeen, { 'proj-b': AT })
    assert.deepEqual(readdirSync(dir), ['proj-b.json'])
    assert.equal(readArchive(dir, 'proj-a').length, 0)
    assert.equal(readArchive(dir, 'proj-b').length, 1)
    assert.ok(existsSync(join(folder, 'arquivo.txt')), 'the project folder is never touched')
    // no archive file and no entry: still fine
    assert.deepEqual(forgetProjectData(dir, undefined, 'proj-a'), {})
    // an id with path tricks never reaches outside the archive folder
    writeFileSync(join(folder, 'dados.json'), '{}')
    forgetProjectData(dir, {}, '../meu-projeto/dados')
    assert.ok(existsSync(join(folder, 'dados.json')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

console.log(`\n${ok} checks passed`)
