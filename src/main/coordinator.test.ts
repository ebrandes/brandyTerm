import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildThreadPrompt, extractQuestion } from './coordinator.ts'
import type { Project } from '../shared/types.ts'

test('thread prompt mentions connectors', () => {
  for (const agent of ['claude', 'codex'] as const) {
    const p = buildThreadPrompt({ name: 'Demo' } as Project, 'obj', agent)
    assert.ok(
      p.includes('Serviços externos (Railway, GitHub e outros) ficam disponíveis pelas ferramentas list_connectors, connector_tools e call_connector; use só quando a tarefa precisar.')
    )
  }
})

import { buildPlanPrompt, parsePlan, PLAN_SCHEMA } from './coordinator.ts'
import type { Thread } from '../shared/types.ts'

const installed = new Map([['claude', ['sonnet']]]) as Parameters<typeof parsePlan>[2]

test('parsePlan reads resume entries and the thread a task replaces', () => {
  const plan = parsePlan(
    {
      reply: 'ok',
      tasks: [{ title: 'Nova', objective: 'o', agent: 'claude', effort: 'low', replaces: 'Antiga' }],
      resume: [{ threadTitle: 'Logs MCP', text: 'Continue.' }, { threadTitle: 'x', text: '  ' }, { text: 'sem título' }]
    },
    '',
    installed
  )
  assert.deepEqual(plan.resume, [{ threadTitle: 'Logs MCP', text: 'Continue.' }])
  assert.equal(plan.tasks[0].replaces, 'Antiga')
})

test('parsePlan without resume gives an empty list', () => {
  assert.deepEqual(parsePlan({ reply: 'ok', tasks: [] }, '', installed).resume, [])
})

test('parsePlan reads ask', () => {
  const plan = parsePlan({ reply: 'ok', tasks: [], ask: [{ threadTitle: 'Logs MCP', text: 'O que mudou?' }, { threadTitle: 'x', text: ' ' }] }, '', installed)
  assert.deepEqual(plan.ask, [{ threadTitle: 'Logs MCP', text: 'O que mudou?' }])
})

test('parsePlan without ask gives []', () => {
  assert.deepEqual(parsePlan({ reply: 'ok', tasks: [] }, '', installed).ask, [])
  assert.deepEqual(parsePlan(undefined, 'texto', installed).ask, [])
})

test('PLAN_SCHEMA has ask', () => {
  assert.ok('ask' in PLAN_SCHEMA.properties)
  assert.ok(!(PLAN_SCHEMA as { required?: string[] }).required?.includes('ask'))
})

test('buildPlanPrompt explains ask', () => {
  const p = buildPlanPrompt({ name: 'P', path: null, processes: [], threads: [], messages: [] } as unknown as Project, ['claude'], 'oi')
  assert.ok(p.includes('"ask": [{"threadTitle","text"}]'))
  assert.ok(p.includes('- Para saber detalhes do que uma thread fez ou decidiu (o resumo acima não basta), devolva em "ask" {threadTitle (exato), text (a pergunta)}; a thread responde e você recebe a resposta para responder ao usuário. Diga em "reply" que foi perguntar. Sem pergunta: ask=[].'))
})

const thread = (title: string, state: Thread['state'], extra: Partial<Thread> = {}) => ({ title, state, agent: 'claude', ...extra }) as Thread
const prompt = (threads: Thread[]) =>
  buildPlanPrompt({ name: 'P', path: null, processes: [], threads, messages: [] } as unknown as Project, ['claude'], 'continue as threads')

test('the plan prompt tells the coordinator to resume interrupted threads instead of opening new ones', () => {
  const p = prompt([thread('Logs MCP', 'interrupted')])
  assert.match(p, /"resume"/)
  assert.match(p, /- "Logs MCP" \(Claude, INTERROMPIDA/)
  assert.match(p, /continuar[\s\S]*"resume"[\s\S]*não crie/i)
})

test('the plan prompt keeps the full title and lists old interrupted threads past the recent ones', () => {
  const long = 'Logs de diagnóstico para conectores MCP, plugins, skills e a'
  const recent = Array.from({ length: 14 }, (_, i) => thread(`Feita ${i}`, 'done'))
  const p = prompt([thread(long, 'interrupted'), ...recent])
  assert.ok(p.includes(`"${long}"`))
  assert.ok(!p.includes('"Feita 0"'))
  assert.ok(p.includes('"Feita 13"'))
})

test('the plan prompt shows a retired thread as set aside, not as resumable', () => {
  const p = prompt([thread('Logs MCP', 'interrupted', { retired: { reason: 'superseded', by: 'n', byTitle: 'Logs MCP v2', at: 'x' } })])
  assert.match(p, /- "Logs MCP" \(Claude, substituída por "Logs MCP v2"\)/)
  assert.doesNotMatch(p, /"Logs MCP" \(Claude, INTERROMPIDA/)
})

test('extractQuestion puts the starred option first and flags it', () => {
  const q = extractQuestion('feito.\nPERGUNTA: Qual caminho?\nOPCOES: só patch | *aplicar + todos | nada')
  assert.deepEqual(q, { text: 'Qual caminho?', options: ['aplicar + todos', 'só patch', 'nada'], recommended: true })
})

test('extractQuestion without a marker keeps order and has no recommendation', () => {
  assert.deepEqual(extractQuestion('PERGUNTA: Sim?\nOPCOES: sim | não'), { text: 'Sim?', options: ['sim', 'não'] })
  assert.deepEqual(extractQuestion('PERGUNTA: Qual nome?'), { text: 'Qual nome?', options: undefined })
})

test('thread prompt asks to mark the recommended option with *', () => {
  const p = buildThreadPrompt({ name: 'Demo' } as Project, 'obj', 'claude')
  assert.ok(p.includes('"OPCOES: *a | b | c"'))
})

test('parsePlan keeps a valid tier and drops an unknown one', () => {
  const task = { title: 'T', objective: 'o', agent: 'claude', effort: 'low' }
  const plan = parsePlan({ reply: 'ok', tasks: [{ ...task, tier: 'pesado' }, { ...task, tier: 'enorme' }, task] }, '', installed)
  assert.deepEqual(plan.tasks.map((t) => t.tier), ['pesado', undefined, undefined])
})

test('PLAN_SCHEMA has the task tier', () => {
  assert.deepEqual(PLAN_SCHEMA.properties.tasks.items.properties.tier.enum, ['leve', 'padrao', 'pesado'])
})

test('the plan prompt asks for a tier, lower when in doubt, and keeps the effort guidance', () => {
  const p = buildPlanPrompt({ name: 'Demo', path: '/tmp/demo', threads: [], processes: [], messages: [] } as unknown as Project, ['claude'], 'oi')
  assert.ok(p.includes('"tier"'))
  assert.ok(p.includes('Na dúvida, o nível de baixo'))
  assert.ok(p.includes('effort: low | medium | high'))
  assert.ok(p.includes('sem ditar passos nem arquivos'))
})

test('prompts send applying a worktree to the queue instead of asking whether threads are running', () => {
  const project = { name: 'Demo', path: '', threads: [], processes: [], messages: [] } as unknown as Project
  for (const p of [buildThreadPrompt(project, 'obj', 'codex'), buildPlanPrompt(project, ['claude'], 'oi')]) {
    assert.match(p, /queue_apply/)
    assert.match(p, /edit(e|ar) direto na pasta do projeto/)
    assert.match(p, /src\/main, src\/preload, src\/shared, package\.json/)
    assert.match(p, /reinicia o app/)
    assert.match(p, /[Nn]unca (pergunte ao usuário se há threads rodando|peça ao usuário para confirmar que não há threads rodando)/)
  }
})
