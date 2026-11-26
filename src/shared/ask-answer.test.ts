import assert from 'node:assert/strict'
import { test } from 'node:test'
import { back, complete, composeAnswers, next, pick, start, write } from './ask-answer.ts'

const questions = ['Prioridade?', 'Direção visual?', 'Lista de espera?', 'Alcance?'].map((text) => ({ text }))

test('does not advance past a question without an answer', () => {
  assert.equal(next(start(4)).at, 0)
  assert.equal(next(write(start(4), '   ')).at, 0)
})

test('advances, goes back and keeps the answers', () => {
  let s = next(pick(start(4), 'Acessibilidade'))
  assert.equal(s.at, 1)
  s = back(write(s, 'algo meu'))
  assert.equal(s.at, 0)
  assert.equal(s.answers[0], 'Acessibilidade')
  assert.equal(s.typed[0], false)
  s = next(s)
  assert.equal(s.answers[1], 'algo meu')
  assert.equal(s.typed[1], true)
})

test('stays inside the first and the last question', () => {
  assert.equal(back(start(2)).at, 0)
  const last = next(pick(next(pick(start(2), 'a')), 'b'))
  assert.equal(last.at, 1)
})

test('is complete only when every question has an answer, then sends all of them', () => {
  let s = start(4)
  for (const answer of ['um', 'dois', 'três']) s = next(pick(s, answer))
  assert.equal(complete(s), false)
  s = write(s, ' quatro ')
  assert.equal(complete(s), true)
  assert.equal(
    composeAnswers(questions, s.answers),
    '1. Prioridade?\nResposta: um\n\n2. Direção visual?\nResposta: dois\n\n' +
      '3. Lista de espera?\nResposta: três\n\n4. Alcance?\nResposta: quatro'
  )
})
