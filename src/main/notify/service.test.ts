import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Project, Thread } from '../../shared/types.ts'
import { createNotifications } from './service.ts'

function rig() {
  const shown: { body: string; click: () => void }[] = []
  const opened: number[] = []
  const flags = { enabled: true, focused: false }
  const service = createNotifications({
    enabled: () => flags.enabled,
    focused: () => flags.focused,
    show: (text, click) => void shown.push({ body: text.body, click }),
    open: () => void opened.push(1)
  })
  const t = { id: 't1', title: 'T', state: 'running' } as unknown as Thread
  const p = { id: 'p1', name: 'Loja', threads: [t], messages: [] } as unknown as Project
  service.observe('local', [p])
  /** one turn of the thread: running, then done */
  const finish = () => {
    t.state = 'running'
    service.observe('local', [p])
    t.state = 'done'
    service.observe('local', [p])
  }
  return { service, shown, opened, flags, finish, p, t }
}

test('janela sem foco notifica, mesmo com a thread selecionada', () => {
  const r = rig()
  r.service.setView({ projectId: 'p1', threadId: 't1' })
  r.finish()
  assert.equal(r.shown.length, 1)
})

test('janela focada vendo a própria thread não notifica', () => {
  const r = rig()
  r.flags.focused = true
  r.service.setView({ projectId: 'p1', threadId: 't1' })
  r.finish()
  assert.equal(r.shown.length, 0)
})

test('janela focada em outra thread, no coordenador, em outro projeto ou coberta notifica', () => {
  const r = rig()
  r.flags.focused = true
  for (const view of [{ projectId: 'p1', threadId: 't2' }, { projectId: 'p1' }, { projectId: 'p2', threadId: 't1' }, null]) {
    r.service.setView(view)
    r.finish()
  }
  assert.equal(r.shown.length, 4)
})

test('vendo o chat do coordenador: a resposta dele não notifica', () => {
  const r = rig()
  r.flags.focused = true
  r.service.setView({ projectId: 'p1' })
  r.p.messages.push({ id: 'm1', author: 'coordinator', text: 'ok', time: '' })
  r.service.observe('local', [r.p])
  assert.equal(r.shown.length, 0)
})

test('desligadas: nada aparece, e ligar depois não despeja o que passou', () => {
  const r = rig()
  r.flags.enabled = false
  r.finish()
  r.flags.enabled = true
  r.service.observe('local', [r.p])
  assert.equal(r.shown.length, 0)
})

test('cada máquina tem sua base; o alvo remoto leva o id roteado', () => {
  const r = rig()
  const remote = (state: string) => [{ id: 'p1', name: 'Loja', threads: [{ id: 't1', title: 'T', state }], messages: [] } as unknown as Project]
  r.service.observe('m1', remote('running'), (id) => `@m1/${id}`)
  r.service.observe('local', [r.p])
  r.service.observe('m1', remote('done'), (id) => `@m1/${id}`)
  assert.equal(r.shown.length, 1)
  r.shown[0].click()
  assert.deepEqual(r.service.takeTarget(), { projectId: '@m1/p1', threadId: 't1' })
})

test('o clique guarda o alvo, abre a janela, e o alvo é entregue uma vez', () => {
  const r = rig()
  r.finish()
  assert.equal(r.service.takeTarget(), null)
  r.shown[0].click()
  assert.equal(r.opened.length, 1)
  assert.deepEqual(r.service.takeTarget(), { projectId: 'p1', threadId: 't1' })
  assert.equal(r.service.takeTarget(), null)
})
