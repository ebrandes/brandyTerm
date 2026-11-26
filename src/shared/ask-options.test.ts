import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOptions } from './ask-options.ts'

test('a starred option moves to the top and is flagged recommended', () => {
  assert.deepEqual(parseOptions('a | *b | c'), { options: ['b', 'a', 'c'], recommended: true })
})

test('a trailing (recomendada)/(Recomendado) also marks the option', () => {
  assert.deepEqual(parseOptions('a | b (recomendada)'), { options: ['b', 'a'], recommended: true })
  assert.deepEqual(parseOptions('x (Recomendado) | y'), { options: ['x', 'y'], recommended: true })
})

test('without a marker the original order stays and nothing is recommended', () => {
  assert.deepEqual(parseOptions('a | b | c'), { options: ['a', 'b', 'c'], recommended: false })
})

test('only the first marked option is recommended; the other loses its marker', () => {
  assert.deepEqual(parseOptions('a | *b | *c'), { options: ['b', 'a', 'c'], recommended: true })
})

test('an option that is only a marker is dropped', () => {
  assert.deepEqual(parseOptions('a | * | b'), { options: ['a', 'b'], recommended: false })
})

test('a star inside the text is not a marker', () => {
  assert.deepEqual(parseOptions('a*b | c'), { options: ['a*b', 'c'], recommended: false })
})

test('keeps at most 6 options, the recommended one included even if listed late', () => {
  const r = parseOptions('1 | 2 | 3 | 4 | 5 | 6 | *7 | 8')
  assert.deepEqual(r, { options: ['7', '1', '2', '3', '4', '5'], recommended: true })
})
