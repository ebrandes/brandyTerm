import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canAnswer, cardQuestion, extractQuestion, isCurrentAsk, isStaleAnswer, stripQuestion } from './ask-question.ts'
import type { Message, Thread } from './types.ts'

const REPLY = 'Feito.\n\n- item\n\nPERGUNTA: Aplicar agora?\nOPCOES: depois | *quando parar | não'

const waiting = (text: string) => ({ state: 'waiting', question: { text } }) as Thread
const msg = (id: string, author: Message['author'], extra: Partial<Message> = {}) =>
  ({ id, author, time: '', text: '', ...extra }) as Message

test('parses the question with the recommended option first', () => {
  assert.deepEqual(extractQuestion(REPLY), {
    text: 'Aplicar agora?',
    options: ['quando parar', 'depois', 'não'],
    recommended: true
  })
})

test('parses a question without options', () => {
  assert.deepEqual(extractQuestion('PERGUNTA: Qual nome?'), { text: 'Qual nome?', options: undefined })
})

test('stripQuestion removes only the question and options lines', () => {
  assert.equal(stripQuestion(REPLY), 'Feito.\n\n- item')
  assert.equal(stripQuestion('antes\nPERGUNTA: Sim?\nOPCOES: a | b\nRESUMO: fim'), 'antes\nRESUMO: fim')
})

test('stripQuestion leaves a reply that is only a question empty', () => {
  assert.equal(stripQuestion('PERGUNTA: Sim?\nOPCOES: a | b'), '')
})

test('stripQuestion keeps text without a question, even when it cites the format', () => {
  const text = 'A linha "PERGUNTA: x" vira um card.\nOPCOES: a | b\n'
  assert.equal(stripQuestion(text), text)
})

test('only a thread waiting on that same question can be answered', () => {
  assert.equal(canAnswer(waiting('Sim?'), 'Sim?'), true)
  assert.equal(canAnswer({ ...waiting('Sim?'), state: 'running' }, 'Sim?'), false)
  assert.equal(canAnswer(waiting('Outra?'), 'Sim?'), false)
  assert.equal(canAnswer(undefined, 'Sim?'), false)
})

test('a second answer to the same question is stale', () => {
  const t = waiting('Sim?')
  assert.equal(isStaleAnswer(t, 'Sim?'), false)
  // what sendToThread does with the first answer
  t.question = undefined
  t.state = 'running'
  assert.equal(isStaleAnswer(t, 'Sim?'), true)
})

test('a message typed in the composer is never stale', () => {
  assert.equal(isStaleAnswer(waiting('Sim?'), undefined), false)
  assert.equal(isStaleAnswer(undefined, undefined), false)
})

test('only the latest agent reply holds the open question', () => {
  const messages = [msg('1', 'agent'), msg('2', 'user'), msg('3', 'agent'), msg('4', 'system')]
  assert.equal(isCurrentAsk(messages, messages[0]), false)
  assert.equal(isCurrentAsk(messages, messages[2]), true)
})

test('a later plan message does not replace the reply that asked', () => {
  const messages = [msg('1', 'agent'), msg('2', 'agent', { plan: true })]
  assert.equal(isCurrentAsk(messages, messages[0]), true)
})

test('several PERGUNTA: lines become one question with the others in `more`', () => {
  const reply = 'Feito.\n\nPERGUNTA: Cor?\nOPCOES: azul | verde\n\nPERGUNTA: Nome?\nRESUMO: fim'
  assert.deepEqual(extractQuestion(reply), { text: 'Cor?', options: ['azul', 'verde'], more: [{ text: 'Nome?', options: undefined }] })
  assert.equal(stripQuestion(reply), 'Feito.\n\n\nRESUMO: fim')
})

test('the first question answers all the cards of that turn', () => {
  const q = extractQuestion('PERGUNTA: Cor?\nPERGUNTA: Nome?')!
  const t = { state: 'waiting', question: q } as Thread
  assert.equal(isStaleAnswer(t, 'Cor?'), false)
  t.question = undefined
  t.state = 'running'
  assert.equal(isStaleAnswer(t, 'Cor?'), true)
})

test('a waiting thread shows its own question on the latest reply when the text holds none', () => {
  const messages = [msg('1', 'agent', { text: 'antes' }), msg('2', 'agent', { text: 'Pronto.' })]
  const t = { ...waiting('Decisão em aberto'), messages } as Thread
  assert.deepEqual(cardQuestion(t, messages[1]), { text: 'Decisão em aberto' })
  assert.equal(cardQuestion(t, messages[0]), undefined)
  assert.equal(cardQuestion({ ...t, state: 'done' }, messages[1]), undefined)
})
