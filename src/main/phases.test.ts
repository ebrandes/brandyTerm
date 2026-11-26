import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLAN_CLIP, afterPlan, execPrompt, inPlan, planPrompt, runSpec, sessionModel } from './phases.ts'
import type { Project, Thread } from '../shared/types.ts'
import type { RunResult } from './run.ts'

const project = { name: 'Demo', path: '/tmp/demo' } as Project
const thread = (over: Partial<Thread> = {}): Thread =>
  ({ agent: 'claude', objective: 'arrumar o login', model: 'sonnet', effort: 'medium', state: 'running', sessionId: 's-plan', plan: { model: 'fable', effort: 'medium' }, ...over }) as Thread
const ok = (text: string): RunResult => ({ done: { kind: 'done', ok: true, text }, usage: { input: 0, output: 0, cached: 0, costUsd: 0 } })
const failed: RunResult = { done: { kind: 'done', ok: false, text: '', error: 'limite' }, usage: { input: 0, output: 0, cached: 0, costUsd: 0 } }

test('a pending plan runs read-only on the plan model; afterwards the thread works on its own', () => {
  const t = thread()
  assert.equal(inPlan(t), true)
  assert.deepEqual(runSpec(t), { model: 'fable', effort: 'medium', tools: 'readonly' })
  assert.deepEqual(sessionModel(t), { model: 'fable', effort: 'medium' })
  t.plan!.done = true
  assert.deepEqual(runSpec(t), { model: 'sonnet', effort: 'medium', tools: 'work' })
  assert.deepEqual(sessionModel(t), { model: 'sonnet', effort: 'medium' })
})

test('threads without a plan, and other agents, work as before', () => {
  assert.deepEqual(runSpec(thread({ plan: undefined, model: 'opus', effort: 'high' })), { model: 'opus', effort: 'high', tools: 'work' })
  assert.equal(inPlan(thread({ agent: 'codex' })), false)
})

test('a written plan hands over to a fresh execution session', () => {
  const t = thread()
  assert.equal(afterPlan(t, ok('1. mexer em `a.ts:10`\n2. rodar os testes')), 'exec')
  assert.deepEqual([t.plan!.done, t.plan!.sessionId, t.sessionId], [true, 's-plan', undefined])
  assert.match(t.plan!.text!, /mexer em/)
})

test('a long plan is clipped', () => {
  const t = thread()
  afterPlan(t, ok('x'.repeat(20000)))
  assert.ok(t.plan!.text!.length <= PLAN_CLIP + 60)
  assert.match(t.plan!.text!, /plano cortado/)
})

test('a question keeps the planning phase open', () => {
  const t = thread()
  assert.equal(afterPlan(t, ok('Falta decidir.\nPERGUNTA: qual banco?\nOPCOES: *a | b')), 'settle')
  assert.deepEqual([t.plan!.done, t.sessionId], [undefined, 's-plan'])
})

test('a final answer ends the thread without execution', () => {
  const t = thread()
  assert.equal(afterPlan(t, ok('**Resultado:** nada a mudar.\nRESUMO: o login já valida o token')), 'settle')
  assert.deepEqual([t.plan!.done, t.plan!.text, t.sessionId], [true, undefined, 's-plan'])
})

test('a failed plan falls back once to opus alone; a cancelled one does not', () => {
  const t = thread()
  assert.equal(afterPlan(t, failed), 'fallback')
  assert.deepEqual([t.plan!.done, t.model, t.effort, t.sessionId], [true, 'opus', 'high', undefined])
  const c = thread({ state: 'cancelled' })
  assert.equal(afterPlan(c, failed), 'settle')
  assert.equal(c.model, 'sonnet')
  assert.equal(afterPlan(thread(), { usage: failed.usage }), 'fallback')
})

test('the skill is loaded in execution only, and execution carries the plan', () => {
  const t = thread({ skill: 'superpowers:systematic-debugging' })
  const plan = planPrompt(project, t)
  assert.ok(plan.includes('arrumar o login'))
  assert.ok(!plan.includes('systematic-debugging'))
  assert.ok(plan.includes('PERGUNTA:') && plan.includes('RESUMO:'))
  assert.ok(plan.includes('NÃO edite'))
  t.plan!.text = 'PASSO-UNICO'
  const exec = execPrompt(project, t)
  assert.ok(exec.includes('PASSO-UNICO') && exec.includes('systematic-debugging'))
  assert.ok(exec.includes('corrija o rumo'))
})

test('a plan that answers leaves the thread on the plan model, the one its session has', () => {
  const t = { agent: 'claude', model: 'sonnet', effort: 'low', sessionId: 's-plan', plan: { model: 'fable', effort: 'medium' } } as unknown as Thread
  const done = { done: { kind: 'done', ok: true, text: 'Nada a mudar.\nRESUMO: já validava' }, usage: { input: 0, output: 0, cached: 0, costUsd: 0 } } as RunResult
  assert.equal(afterPlan(t, done), 'settle')
  assert.deepEqual(sessionModel(t), { model: 'fable', effort: 'medium' })
  assert.equal(t.sessionId, 's-plan')
})

test('a real plan that also carries a RESUMO line is still executed', () => {
  const t = { agent: 'claude', model: 'sonnet', effort: 'medium', plan: { model: 'fable', effort: 'medium' } } as unknown as Thread
  const text = '**Entendimento:** x\n**Passos:**\n1. mexer em a.ts\nRESUMO: plano pronto'
  const done = { done: { kind: 'done', ok: true, text }, usage: { input: 0, output: 0, cached: 0, costUsd: 0 } } as RunResult
  assert.equal(afterPlan(t, done), 'exec')
  assert.equal(t.plan!.text, text)
})

test('a cancelled planning run settles whatever the thread state says', () => {
  const t = { agent: 'claude', state: 'running', model: 'sonnet', effort: 'medium', plan: { model: 'fable', effort: 'medium' } } as unknown as Thread
  const failed = { done: { kind: 'done', ok: false, text: '', error: 'cancelado' }, usage: { input: 0, output: 0, cached: 0, costUsd: 0 } } as RunResult
  assert.equal(afterPlan(t, failed, true), 'settle')
  assert.deepEqual([t.plan!.done, t.model], [undefined, 'sonnet'])
})
