import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Message, Project, Thread } from '../../shared/types.ts'
import { createTracker, notificationText } from './rules.ts'

const thread = (over: Partial<Thread> = {}): Thread =>
  ({ id: 't1', title: 'Corrigir login', state: 'running', messages: [], steps: [], ...over }) as unknown as Thread
const project = (threads: Thread[] = [], messages: Message[] = [], over: Partial<Project> = {}): Project =>
  ({ id: 'p1', name: 'Loja', busy: false, threads, messages, ...over }) as unknown as Project
let n = 0
const msg = (author: Message['author'], text: string, over: Partial<Message> = {}): Message =>
  ({ id: `m${++n}`, author, text, time: '', ...over })
const kinds = (events: { kind: string }[]) => events.map((e) => e.kind)

test('o primeiro estado visto só vira base: nada no boot nem ao restaurar', () => {
  const tracker = createTracker()
  const p = project(
    [thread({ state: 'done' }), thread({ id: 't2', state: 'waiting' }), thread({ id: 't3', state: 'failed' })],
    [msg('coordinator', 'Pronto?')]
  )
  assert.deepEqual(tracker.observe([p]), [])
  assert.deepEqual(tracker.observe([p]), [])
})

test('thread concluída ou com falha notifica uma única vez', () => {
  for (const state of ['done', 'failed'] as const) {
    const tracker = createTracker()
    const t = thread()
    const p = project([t])
    tracker.observe([p])
    t.state = state
    assert.deepEqual(tracker.observe([p]), [{ kind: state, projectId: 'p1', projectName: 'Loja', threadId: 't1', threadTitle: 'Corrigir login' }])
    assert.deepEqual(tracker.observe([p]), [])
  }
})

test('um novo turno que termina notifica de novo', () => {
  const tracker = createTracker()
  const t = thread()
  const p = project([t])
  tracker.observe([p])
  const seen: string[] = []
  for (const state of ['done', 'running', 'done'] as const) {
    t.state = state
    seen.push(...kinds(tracker.observe([p])))
  }
  assert.deepEqual(seen, ['done', 'done'])
})

test('cancelada, interrompida e mudanças sem turno rodando não notificam', () => {
  const cases = [['running', 'cancelled'], ['running', 'interrupted'], ['waiting', 'done'], ['interrupted', 'failed'], ['done', 'failed']] as const
  for (const [from, to] of cases) {
    const tracker = createTracker()
    const t = thread({ state: from })
    tracker.observe([project([t])])
    t.state = to
    assert.deepEqual(tracker.observe([project([t])]), [], `${from} -> ${to}`)
  }
})

test('thread que aparece já terminada (reaberta do arquivo) não notifica', () => {
  const tracker = createTracker()
  tracker.observe([project()])
  assert.deepEqual(tracker.observe([project([thread({ state: 'done' })])]), [])
})

test('pergunta, aprovação e login de conector notificam "aguardando" na entrada da espera', () => {
  const waits: Partial<Thread>[] = [
    { state: 'waiting' },
    { approval: { id: 'a1' } as Thread['approval'] },
    { logins: [{}] as Thread['logins'] }
  ]
  for (const wait of waits) {
    const tracker = createTracker()
    const t = thread()
    tracker.observe([project([t])])
    Object.assign(t, wait)
    assert.deepEqual(kinds(tracker.observe([project([t])])), ['waiting'])
    assert.deepEqual(tracker.observe([project([t])]), [])
  }
})

test('aprovações em fila não repetem; uma nova espera depois de rodar notifica', () => {
  const tracker = createTracker()
  const t = thread()
  const seen: string[] = []
  tracker.observe([project([t])])
  for (const approval of ['a1', 'a2', undefined, 'a3']) {
    t.approval = approval ? ({ id: approval } as Thread['approval']) : undefined
    seen.push(...kinds(tracker.observe([project([t])])))
  }
  assert.deepEqual(seen, ['waiting', 'waiting'])
})

test('coordenador notifica só quando deixa de trabalhar, uma vez', () => {
  const tracker = createTracker()
  const p = project([], [msg('user', 'oi')])
  tracker.observe([p])
  p.busy = true
  p.messages.push(msg('coordinator', 'Deleguei a uma thread.'))
  assert.deepEqual(tracker.observe([p]), [])
  p.busy = false
  assert.deepEqual(tracker.observe([p]), [{ kind: 'done', projectId: 'p1', projectName: 'Loja' }])
  assert.deepEqual(tracker.observe([p]), [])
})

test('resposta que termina em pergunta é "aguardando sua resposta"', () => {
  for (const text of ['Qual das duas?', 'Posso aplicar **agora?**\n']) {
    const tracker = createTracker()
    const p = project()
    tracker.observe([p])
    p.messages.push(msg('coordinator', text))
    assert.deepEqual(kinds(tracker.observe([p])), ['waiting'], text)
  }
})

test('falha do coordenador notifica "falhou", mesmo junto de uma resposta parcial', () => {
  const tracker = createTracker()
  const p = project()
  tracker.observe([p])
  p.messages.push(msg('coordinator', 'Resultado parcial abaixo.'), msg('system', 'O coordenador falhou na síntese. x', { isError: true }))
  assert.deepEqual(kinds(tracker.observe([p])), ['failed'])
  p.messages.push(msg('system', 'Erro interno do coordenador: y', { isError: true }))
  assert.deepEqual(kinds(tracker.observe([p])), ['failed'])
})

test('compactação, avisos do sistema, agentes, usuário e eco de comando não notificam', () => {
  const tracker = createTracker()
  const p = project([], [], { busy: true })
  tracker.observe([p])
  p.busy = false
  p.messages.push(
    msg('system', 'Contexto compactado.'),
    msg('system', 'A pasta do projeto não existe mais', { isError: true }),
    msg('agent', 'A thread respondeu.'),
    msg('user', 'e aí?'),
    msg('coordinator', 'Rodando `/review` numa thread do Claude.')
  )
  assert.deepEqual(tracker.observe([p]), [])
})

test('histórico limpo ou projeto reaberto vira base de novo', () => {
  const tracker = createTracker()
  tracker.observe([project([], [msg('coordinator', 'a')])])
  assert.deepEqual(tracker.observe([project([], [msg('coordinator', 'outra conversa')])]), [])
  tracker.observe([])
  assert.deepEqual(tracker.observe([project([thread({ state: 'done' })], [msg('coordinator', 'b')])]), [])
})

test('texto curto: projeto, título e o que aconteceu, sem conteúdo', () => {
  const base = { projectId: 'p1', projectName: 'Loja', threadId: 't1', threadTitle: 'Corrigir login' }
  assert.deepEqual(notificationText({ ...base, kind: 'done' }), { title: 'Loja', body: 'Corrigir login — terminou' })
  assert.deepEqual(notificationText({ ...base, kind: 'failed' }), { title: 'Loja', body: 'Corrigir login — falhou' })
  assert.deepEqual(notificationText({ projectId: 'p1', projectName: 'Loja', kind: 'waiting' }), { title: 'Loja', body: 'Coordenador — aguardando sua resposta' })
  const long = notificationText({ ...base, threadTitle: 'x\n'.repeat(200), kind: 'done' })
  assert.ok(long.body.length <= 90 && !long.body.includes('\n'))
})
