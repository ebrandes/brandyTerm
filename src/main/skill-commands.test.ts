import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Message, Project, Thread } from '../shared/types.ts'
import type { PlannedTask } from './coordinator.ts'
import type { Engine } from './engine.ts'
import { APP_COMMANDS, helpText } from './commands.ts'
import { runSkillCommand, setSkillEnv } from './skill-commands.ts'
import { upsertCatalog } from './skills/catalog.ts'
import type { GitRun } from './skills/library.ts'
import { skillsPaths } from './skills/paths.ts'

function fakeEngine(o: { claude?: boolean } = {}) {
  const created: PlannedTask[] = []
  const started: { t: Thread; prompt: string; direct: boolean; skillsTask?: string }[] = []
  const e = {
    msg: (author: Message['author'], text: string, extra?: Partial<Message>) => ({ id: 'm', author, text, createdAt: '', ...extra }) as Message,
    touch() {},
    installed: () => new Map(o.claude === false ? [] : [['claude', []]]),
    createThread(p: Project, task: PlannedTask) {
      created.push(task)
      const t = { id: `t${created.length}`, title: task.title, objective: task.objective, agent: task.agent } as Thread
      p.threads.push(t)
      return t
    },
    startThread(_p: Project, t: Thread, prompt: string, direct: boolean) {
      started.push({ t, prompt, direct, skillsTask: t.skillsTask })
    },
  }
  return { e: e as unknown as Engine, created, started }
}

function setup(t: { after(fn: () => void): void }, o: { pull?: number; path?: string | null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'skcmd-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const paths = skillsPaths(join(root, 'ud'))
  mkdirSync(join(paths.lib, '.git'), { recursive: true })
  const other = process.platform === 'win32' ? 'mac' : 'win'
  upsertCatalog(paths.lib, { id: 'impeccable@impeccable', tipo: 'plugin', descricao: 'Acabamento de interface.', tags: ['frontend'] })
  upsertCatalog(paths.lib, { id: 'so-outro@x', tipo: 'plugin', descricao: 'Só no outro sistema.', tags: [], plataformas: [other] })
  const gitCalls: string[][] = []
  const git: GitRun = (args) => {
    gitCalls.push(args)
    return { code: args.includes('pull') ? (o.pull ?? 0) : 0, out: '' }
  }
  setSkillEnv(() => ({ paths, library: 'o/lib', git }))
  const project = join(root, 'proj')
  mkdirSync(project)
  const p = { id: 'p1', name: 'proj', path: o.path === null ? null : project, threads: [], messages: [] } as unknown as Project
  return { p, gitCalls, ...fakeEngine() }
}

const texts = (p: Project) => p.messages.map((m) => `${m.author}: ${m.text}`)

test('a project without a folder gets a note and no thread', (t) => {
  const f = setup(t, { path: null })
  runSkillCommand(f.e, f.p, { name: 'skill-init', args: '' }, [])
  assert.deepEqual(texts(f.p), ['user: /skill-init', 'system: Esse comando precisa de um projeto com pasta.'])
  assert.equal(f.created.length, 0)
})

test('without Claude it gets the same note as the other / commands', (t) => {
  const f = setup(t)
  const { e, created } = fakeEngine({ claude: false })
  runSkillCommand(e, f.p, { name: 'skill-refresh', args: '' }, [])
  assert.deepEqual(texts(f.p).at(-1), 'system: Comandos com / precisam do Claude Code instalado.')
  assert.equal(created.length, 0)
})

test('/skill-init pulls the library and starts a skills thread with the catalog prompt', (t) => {
  const f = setup(t)
  runSkillCommand(f.e, f.p, { name: 'skill-init', args: '' }, [])
  assert.deepEqual(f.gitCalls, [['-C', join(f.p.path!, '..', 'ud', 'biblioteca'), 'pull', '--ff-only']])
  assert.deepEqual(f.created, [{ title: '/skill-init', objective: '/skill-init', agent: 'claude', effort: 'medium', why: 'comando / do usuário' }])
  assert.equal(f.started.length, 1)
  const s = f.started[0]
  assert.equal(s.skillsTask, 'init')
  assert.equal(s.direct, true)
  assert.ok(s.prompt.includes('- impeccable@impeccable [frontend]: Acabamento de interface.'))
  assert.ok(s.prompt.includes('use skills_add para cada item'))
  // items for another platform stay out
  assert.equal(s.prompt.includes('so-outro@x'), false)
  assert.equal(s.prompt.includes('npx skills find'), false)
  assert.deepEqual(f.p.messages.map((m) => m.author), ['user', 'coordinator'])
})

test('a library that could not update becomes a note, and the thread still starts', (t) => {
  const f = setup(t, { pull: 1 })
  runSkillCommand(f.e, f.p, { name: 'skill-refresh', args: '' }, [])
  assert.ok(texts(f.p).some((x) => x.startsWith('system: Biblioteca sem atualizar')))
  assert.equal(f.started[0].skillsTask, 'refresh')
})

test('/skill-install needs an origin; with one and --buscar, both reach the prompt', (t) => {
  const f = setup(t)
  runSkillCommand(f.e, f.p, { name: 'skill-install', args: '' }, [])
  assert.match(texts(f.p).at(-1)!, /^system: Use \/skill-install <origem>/)
  assert.equal(f.created.length, 0)
  runSkillCommand(f.e, f.p, { name: 'skill-install', args: 'o/r --buscar' }, [])
  const s = f.started[0]
  assert.equal(s.skillsTask, 'install')
  assert.ok(s.prompt.includes('Origem: o/r\n'))
  assert.ok(s.prompt.includes('npx skills find'))
})

test('inside a thread it only says where the command runs', (t) => {
  const f = setup(t)
  const th = { id: 'x', agent: 'claude', messages: [] } as unknown as Thread
  runSkillCommand(f.e, f.p, { name: 'skill-init', args: '' }, [], th)
  assert.deepEqual(th.messages.map((m) => `${m.author}: ${m.text}`), ['user: /skill-init', 'system: Os comandos /skill-* rodam no chat do projeto, fora das threads.'])
  assert.equal(f.p.messages.length, 0)
  assert.equal(f.created.length, 0)
})

test('a broken catalog or project list stops before any thread', (t) => {
  const f = setup(t)
  writeFileSync(join(f.p.path!, '..', 'ud', 'biblioteca', 'biblioteca', 'catalogo.json'), '{ quebrado')
  runSkillCommand(f.e, f.p, { name: 'skill-init', args: '' }, [])
  assert.equal(texts(f.p).at(-1), 'system: catalogo.json inválido: corrija a biblioteca antes de mudar a lista.')
  const g = setup(t)
  mkdirSync(join(g.p.path!, '.brandyterm'))
  writeFileSync(join(g.p.path!, '.brandyterm', 'skills.json'), '[]')
  runSkillCommand(g.e, g.p, { name: 'skill-refresh', args: '' }, [])
  assert.equal(texts(g.p).at(-1), 'system: skills.json inválido: corrija o arquivo antes de mudar a lista.')
  assert.equal(f.created.length + g.created.length, 0)
})

test('an invalid library setting becomes a note, and the copy on disk is used', (t) => {
  const f = setup(t)
  const paths = skillsPaths(join(f.p.path!, '..', 'ud'))
  setSkillEnv(() => ({ paths, library: 'nao vale', git: () => assert.fail('git não deveria rodar') }))
  runSkillCommand(f.e, f.p, { name: 'skill-init', args: '' }, [])
  assert.ok(texts(f.p).includes('system: Biblioteca inválida nas configurações (use dono/repo ou uma URL https): usando a cópia que já existe.'))
  assert.ok(f.started[0].prompt.includes('impeccable@impeccable'))
})

test('after the library update the panel hears about it, even when the update failed', (t) => {
  const f = setup(t, { pull: 1 })
  const paths = skillsPaths(join(f.p.path!, '..', 'ud'))
  let synced = 0
  setSkillEnv(() => ({ paths, library: 'o/lib', git: () => ({ code: 1, out: '' }), onSync: () => synced++ }))
  runSkillCommand(f.e, f.p, { name: 'skill-init', args: '' }, [])
  assert.equal(synced, 1)
})

test('help lists the three skill commands', () => {
  const help = helpText(APP_COMMANDS)
  for (const n of ['skill-init', 'skill-refresh', 'skill-install']) assert.ok(help.includes(`/${n}\``), n)
})
