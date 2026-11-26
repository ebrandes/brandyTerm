import test from 'node:test'
import assert from 'node:assert/strict'
import { askPrompt, followUpPrompt, parseReport, reportNotes, reportPrompt } from './thread-report-text.ts'

test('reportPrompt pede as linhas certas', () => {
  const c = reportPrompt('curto')
  for (const l of ['FEITO:', 'DECIDIDO:', 'ARQUIVOS:']) assert.ok(c.includes(l))
  assert.ok(!c.includes('PENDENTE:'))
  assert.ok(reportPrompt('completo').includes('PENDENTE:'))
  assert.ok(c.includes('Não altere arquivos'))
})
test('parseReport lê as linhas, multilinha até a próxima etiqueta', () => {
  const r = parseReport('FEITO: a\nb\nDECIDIDO: c\nARQUIVOS: x.ts, y.ts\nPENDENTE: nada')
  assert.deepEqual(r, { feito: 'a b', decidido: 'c', arquivos: 'x.ts, y.ts', pendente: undefined, texto: 'FEITO: a\nb\nDECIDIDO: c\nARQUIVOS: x.ts, y.ts\nPENDENTE: nada' })
})
test('parseReport sem etiquetas guarda só o texto, cortado em 600', () => {
  const r = parseReport('x'.repeat(700))
  assert.equal(r.feito, undefined)
  assert.equal(r.texto.length, 600)
})
test('reportNotes', () => {
  const r = parseReport('FEITO: f\nDECIDIDO: d\nARQUIVOS: a\nPENDENTE: p')
  assert.deepEqual(reportNotes('T', r, 'completo'), [
    { section: 'Recente', text: '“T”: f' },
    { section: 'Decisões', text: '“T”: d' },
    { section: 'Pendências', text: '“T”: p' }
  ])
  assert.deepEqual(reportNotes('T', r, 'curto').map((n) => n.section), ['Recente', 'Decisões'])
  assert.deepEqual(reportNotes('T', parseReport('solto'), 'curto'), [])
})
test('askPrompt e followUpPrompt carregam pergunta e resposta', () => {
  assert.ok(askPrompt('por que X?').includes('por que X?'))
  const f = followUpPrompt('T', 'por que X?', 'porque Y')
  for (const s of ['“T”', 'por que X?', 'porque Y', '"reply"']) assert.ok(f.includes(s))
})
