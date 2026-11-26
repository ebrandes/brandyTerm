import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOverride, routeTasks, type Override, type RouteDeps } from './router.ts'
import type { PlannedTask } from './coordinator.ts'

const task = (over: Partial<PlannedTask> = {}): PlannedTask => ({ title: 'T', objective: 'o', agent: 'claude', model: 'opus', effort: 'high', ...over })
const none: Override = { kind: 'none', text: '' }

function deps(over: Partial<RouteDeps> = {}): RouteDeps & { calls: number } {
  const d: RouteDeps & { calls: number } = { calls: 0, mode: 'auto', classify: null, previous: () => null }
  d.classify = async () => (d.calls++, 'padrao')
  return Object.assign(d, over)
}

test("the coordinator's tier is applied without the classifier", async () => {
  const d = deps()
  const [t] = await routeTasks([task({ tier: 'leve' })], none, d)
  assert.equal(d.calls, 0)
  assert.deepEqual([t.model, t.effort, t.plan], ['haiku', 'low', undefined])
})

test('a task without a tier goes to the classifier', async () => {
  const d = deps()
  const [t] = await routeTasks([task()], none, d)
  assert.equal(d.calls, 1)
  assert.deepEqual([t.model, t.effort, t.tier], ['sonnet', 'medium', 'padrao'])
  assert.match(t.why!, /^rota: padrao \(haiku\)/)
})

test("no tier and no classification keeps the coordinator's choice", async () => {
  for (const classify of [async () => null, null]) {
    const [t] = await routeTasks([task()], none, deps({ classify }))
    assert.deepEqual([t.model, t.effort, t.plan, t.tier], ['opus', 'high', undefined, undefined])
  }
})

test('pesado on claude plans with fable and executes with sonnet, with or without a skill', async () => {
  for (const skill of [undefined, 'superpowers:systematic-debugging']) {
    const [t] = await routeTasks([task({ tier: 'pesado', skill })], none, deps())
    assert.deepEqual([t.model, t.effort, t.plan], ['sonnet', 'medium', { model: 'fable', effort: 'medium' }])
    assert.match(t.why!, /^rota: pesado · plano fable → sonnet/)
  }
})

test('codex gets only the effort and antigravity is untouched', async () => {
  const [c, a] = await routeTasks([task({ agent: 'codex', model: undefined, effort: 'low', tier: 'pesado' }), task({ agent: 'antigravity', tier: 'pesado' })], none, deps())
  assert.deepEqual([c.model, c.effort, c.plan], [undefined, 'high', undefined])
  assert.deepEqual([a.model, a.effort, a.plan, a.why], ['opus', 'high', undefined, undefined])
})

test('a task that replaces a failed thread goes one step up', async () => {
  const up = async (prev: ReturnType<RouteDeps['previous']>, tier: PlannedTask['tier']) => (await routeTasks([task({ tier })], none, deps({ previous: () => prev })))[0]
  assert.equal((await up({ tier: 'leve' }, 'leve')).model, 'sonnet')
  // an old thread without a tier counts as padrao
  assert.deepEqual((await up({}, 'leve')).plan, { model: 'fable', effort: 'medium' })
  const boosted = await up({ tier: 'pesado' }, 'padrao')
  assert.deepEqual([boosted.tier, boosted.boost, boosted.model, boosted.effort, boosted.plan], ['pesado', true, 'opus', 'high', { model: 'fable', effort: 'medium' }])
  assert.match(boosted.why!, /^rota: pesado\+ \(substitui falha\) · plano fable → opus/)
  assert.equal((await up({ tier: 'pesado', boost: true }, 'pesado')).boost, true)
  // the coordinator's own higher tier stays
  assert.equal((await up({ tier: 'leve' }, 'pesado')).model, 'sonnet')
  assert.ok((await up({ tier: 'leve' }, 'pesado')).plan)
})

test('aviso only annotates', async () => {
  const [t] = await routeTasks([task({ tier: 'pesado' })], none, deps({ mode: 'aviso' }))
  assert.deepEqual([t.model, t.effort, t.plan], ['opus', 'high', undefined])
  assert.match(t.why!, /aviso: não aplicado/)
})

test('off leaves tasks alone, but typed shortcuts still apply', async () => {
  const off = deps({ mode: 'off' })
  assert.deepEqual(await routeTasks([task({ tier: 'pesado' })], none, off), [task({ tier: 'pesado' })])
  const [forced] = await routeTasks([task({ tier: 'pesado' })], { kind: 'model', model: 'haiku', text: '' }, off)
  assert.deepEqual([forced.model, forced.effort, forced.plan], ['haiku', 'low', undefined])
  const [planned] = await routeTasks([task({ tier: 'leve' })], { kind: 'plan', text: '' }, off)
  assert.deepEqual([planned.tier, planned.model, planned.plan], ['pesado', 'sonnet', { model: 'fable', effort: 'medium' }])
})

test('!! skips routing', async () => {
  assert.deepEqual(await routeTasks([task({ tier: 'pesado' })], { kind: 'skip', text: '' }, deps()), [task({ tier: 'pesado' })])
})

test('parseOverride reads !plano', () => {
  assert.deepEqual(parseOverride('!plano faz x'), { kind: 'plan', text: 'faz x' })
  assert.deepEqual(parseOverride('!planos faz x'), { kind: 'none', text: '!planos faz x' })
  assert.deepEqual(parseOverride('!opus y'), { kind: 'model', model: 'opus', text: 'y' })
})
