import test from 'node:test'
import assert from 'node:assert/strict'
import type { CatalogItem } from '../../shared/types.ts'
import { skillPrompt } from './prompts.ts'

const item = (id: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({ id, tipo: 'plugin', descricao: '', tags: [], ...extra })
const itens = [
  item('impeccable@impeccable', { tags: ['frontend', 'design'], descricao: 'Acabamento de interface.' }),
  item('vivo@claude-kit-private', { corporativo: true, tags: ['vivo'], descricao: 'Processum.' }),
  item('kit-core@claude-kit', { sempre: true, descricao: 'Base de trabalho.' }),
  item('graphify', { tipo: 'skill', descricao: 'Grafo de código.' }),
]
const signals = { deps: ['react'], arquivos: { '.ts': 3 }, readme: 'Leia-me', skillsLocais: ['x'] }
const base = { args: '', itens, list: null, signals, buscar: false }
const KINDS = ['init', 'refresh', 'install'] as const

test('every kind lists the catalog, the signals as JSON and the shared rules', () => {
  for (const kind of KINDS) {
    const p = skillPrompt(kind, { ...base, args: kind === 'install' ? 'o/r' : '' })
    assert.ok(p.includes('- impeccable@impeccable [frontend, design]: Acabamento de interface.'), kind)
    assert.ok(p.includes('- graphify []: Grafo de código.'), kind)
    assert.ok(p.includes('```json\n' + JSON.stringify(signals, null, 2) + '\n```'), kind)
    assert.ok(p.includes('use skills_add para cada item, um por vez, com o motivo em uma linha'), kind)
    assert.ok(p.includes('itens corporativos só se o projeto já tiver a tag ou o usuário pedir'), kind)
    assert.ok(p.includes('responda em português do Brasil'), kind)
    assert.ok(p.includes('agrupe por tag'), kind)
  }
})

test('base and corporate items are marked in the catalog lines', () => {
  const p = skillPrompt('init', base)
  assert.match(p, /- kit-core@claude-kit \[\]: Base de trabalho\. \(base: já entra em todo projeto\)/)
  assert.match(p, /- vivo@claude-kit-private \[vivo\]: Processum\. \(corporativo\)/)
})

test('the current list is shown, or the prompt says the project has none', () => {
  assert.match(skillPrompt('init', base), /Projeto sem lista/)
  const list = { versao: 1 as const, plugins: [{ id: 'impeccable@impeccable' }], skills: [], sem: [] }
  assert.ok(skillPrompt('refresh', { ...base, list }).includes(JSON.stringify(list, null, 2)))
})

test('refresh also proposes removals and never writes without the card', () => {
  const p = skillPrompt('refresh', base)
  assert.ok(p.includes('skills_remove'))
  assert.ok(p.includes('não grave nada sem o cartão aprovado'))
})

test('install carries the origin and the resolve → import → push flow, in order', () => {
  const p = skillPrompt('install', { ...base, args: 'https://github.com/o/r' })
  const at = (s: string) => {
    const i = p.indexOf(s)
    assert.ok(i >= 0, s)
    return i
  }
  assert.ok(at('https://github.com/o/r') < at('chame skills_resolve'))
  at('se a loja tiver vários plugins, pergunte qual')
  assert.ok(at('chame skills_resolve') < at('skills_import'))
  at('descrição em pt-BR escrita a partir do SKILL.md')
  assert.ok(at('skills_import') < at('ofereça skills_push'))
})

test('--buscar adds the outside search: sources, floor, card fields, then the security path', () => {
  const p = skillPrompt('init', { ...base, buscar: true })
  const order = [
    'claude-plugins-official',
    'anthropics/skills',
    'npx skills find <termo>',
    'gh search repos --topic claude-skills --topic agent-skills --topic claude-code-plugin --sort stars',
    '100 estrelas ou 1 mil instalações, e commit nos últimos 6 meses',
    '"pouco usado"',
    'estrelas, instalações, data do último commit e o motivo',
    'candidato novo passa por skills_resolve + skills_import (que roda a checagem de segurança)',
  ]
  const idx = order.map((s) => p.indexOf(s))
  for (let i = 0; i < order.length; i++) assert.ok(idx[i] >= 0, order[i])
  for (let i = 1; i < order.length; i++) assert.ok(idx[i - 1] < idx[i], `${order[i - 1]} antes de ${order[i]}`)
})

test('what the user typed after /skill-init or /skill-refresh reaches the prompt', () => {
  assert.ok(skillPrompt('init', { ...base, args: 'foque em testes' }).includes('Pedido do usuário: foque em testes'))
  assert.equal(skillPrompt('refresh', base).includes('Pedido do usuário'), false)
})

test('the thread ends with the question or summary lines the app reads', () => {
  for (const kind of KINDS) {
    const p = skillPrompt(kind, base)
    assert.ok(p.includes('"PERGUNTA: <pergunta curta>"'), kind)
    assert.ok(p.includes('"OPCOES: a | b | c"'), kind)
    assert.ok(p.includes('"RESUMO: <uma frase>"'), kind)
  }
})

test('without --buscar there is no outside search', () => {
  for (const kind of KINDS) assert.equal(skillPrompt(kind, base).includes('npx skills find'), false, kind)
})
