import test from 'node:test'
import assert from 'node:assert/strict'
import { askPrompt, followUpPrompt, parseReport, reportBody, reportNotes, reportPrompt, reportShort } from './thread-report-text.ts'

test('reportPrompt pede as linhas certas', () => {
  const c = reportPrompt('curto')
  for (const l of ['FEITO:', 'DECIDIDO:', 'ARQUIVOS:']) assert.ok(c.includes(l))
  assert.ok(!c.includes('PENDENTE:'))
  assert.ok(reportPrompt('completo').includes('PENDENTE:'))
  assert.ok(c.includes('Não altere arquivos'))
  for (const s of [c, reportPrompt('completo'), askPrompt('x')]) {
    assert.ok(s.includes('Não altere arquivos nem rode comandos nesta resposta.'))
  }
})
test('parseReport lê as linhas, multilinha até a próxima etiqueta', () => {
  const r = parseReport('FEITO: a\nb\nDECIDIDO: c\nARQUIVOS: x.ts, y.ts\nPENDENTE: nada')
  assert.deepEqual(r, { feito: 'a b', decidido: 'c', arquivos: 'x.ts, y.ts', pendente: undefined, texto: 'FEITO: a\nb\nDECIDIDO: c\nARQUIVOS: x.ts, y.ts\nPENDENTE: nada' })
})
test('parseReport sem etiquetas guarda só o texto, inteiro', () => {
  const r = parseReport('x'.repeat(2500))
  assert.equal(r.feito, undefined)
  assert.equal(r.texto.length, 2500)
})
test('parseReport: RESUMO, PERGUNTA e OPCOES encerram a etiqueta e não entram no valor', () => {
  const r = parseReport('FEITO: a\nDECIDIDO: c\nRESUMO: tudo pronto\nsolta')
  assert.equal(r.decidido, 'c')
  assert.equal(r.feito, 'a')
  assert.equal(parseReport('FEITO: a\n- **PERGUNTA:** qual?\n  opcoes: x | y').feito, 'a')
  assert.equal(parseReport('FEITO: a\n**Resumo**: r\nPENDENTE: p').pendente, 'p')
  assert.deepEqual(reportNotes('T', parseReport('DECIDIDO: c\nRESUMO: r'), 'curto'), [{ section: 'Decisões', text: '“T”: c' }])
})
test('reportBody: lista markdown com os campos presentes, Pendente só no completo', () => {
  const r = parseReport('FEITO: f\nDECIDIDO: nada\nARQUIVOS: a.ts\nPENDENTE: p')
  assert.equal(reportBody(r, 'curto'), '- **Feito:** f\n- **Arquivos:** a.ts')
  assert.equal(reportBody(r, 'completo'), '- **Feito:** f\n- **Arquivos:** a.ts\n- **Pendente:** p')
  const long = 'y'.repeat(800)
  assert.equal(reportBody(parseReport(`FEITO: ${long}`), 'completo'), `- **Feito:** ${long}`)
})
test('reportBody sem etiquetas: o texto, cortado em 600 (curto) ou 2000 (completo) com "…"', () => {
  assert.equal(reportBody(parseReport('  linha 1\nlinha 2  '), 'curto'), 'linha 1\nlinha 2')
  const r = parseReport('x'.repeat(2500))
  assert.equal(reportBody(r, 'curto'), 'x'.repeat(600) + '…')
  assert.equal(reportBody(r, 'completo'), 'x'.repeat(2000) + '…')
  assert.equal(reportBody(parseReport('x'.repeat(2000)), 'completo'), 'x'.repeat(2000))
  assert.equal(reportBody(parseReport('PENDENTE: p\nsolto'), 'curto'), 'PENDENTE: p\nsolto')
})
test('reportShort: o FEITO, ou os primeiros 200 caracteres do texto com "…"', () => {
  assert.equal(reportShort(parseReport('FEITO: f\nDECIDIDO: d')), 'f')
  assert.equal(reportShort(parseReport('solto')), 'solto')
  assert.equal(reportShort(parseReport('z'.repeat(300))), 'z'.repeat(200) + '…')
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
test('parseReport aceita etiquetas em negrito, com marcador e em minúsculas', () => {
  assert.equal(parseReport('**FEITO:** a').feito, 'a')
  assert.equal(parseReport('- **DECIDIDO**: b').decidido, 'b')
  assert.equal(parseReport('feito: c').feito, 'c')
  assert.equal(parseReport('  * ARQUIVOS: x.ts').arquivos, 'x.ts')
})
test('parseReport trata "Nada." e "nenhum." como vazio', () => {
  const r = parseReport('FEITO: f\nPENDENTE: Nada.\nDECIDIDO: nenhum.')
  assert.equal(r.pendente, undefined)
  assert.equal(r.decidido, undefined)
  assert.equal(r.feito, 'f')
})
