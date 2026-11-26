import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOrigin } from './origin.ts'

test('a GitHub URL', () => {
  assert.deepEqual(parseOrigin('https://github.com/CloudAI-X/threejs-skills'), { kind: 'github', owner: 'CloudAI-X', repo: 'threejs-skills' })
  assert.deepEqual(parseOrigin('https://github.com/o/r/'), { kind: 'github', owner: 'o', repo: 'r' })
  assert.deepEqual(parseOrigin('  https://www.github.com/o/r.git  '), { kind: 'github', owner: 'o', repo: 'r' })
})

test('a tree URL gives the sub folder and the branch', () => {
  assert.deepEqual(parseOrigin('https://github.com/o/r/tree/main/skills/x'), { kind: 'github', owner: 'o', repo: 'r', ref: 'main', sub: 'skills/x' })
  assert.deepEqual(parseOrigin('https://github.com/o/r/tree/dev'), { kind: 'github', owner: 'o', repo: 'r', ref: 'dev' })
})

test('short forms', () => {
  assert.deepEqual(parseOrigin('o/r'), { kind: 'github', owner: 'o', repo: 'r' })
  assert.deepEqual(parseOrigin('o/r.git'), { kind: 'github', owner: 'o', repo: 'r' })
  assert.deepEqual(parseOrigin('o/r/sub/dir'), { kind: 'github', owner: 'o', repo: 'r', sub: 'sub/dir' })
})

test('catalog ids', () => {
  assert.deepEqual(parseOrigin('impeccable@impeccable'), { kind: 'catalog', id: 'impeccable@impeccable' })
  assert.deepEqual(parseOrigin('graphify'), { kind: 'catalog', id: 'graphify' })
})

test('refused forms', () => {
  for (const bad of [
    'https://gitlab.com/o/r',
    'http://github.com/o/r',
    'o/../r',
    'o/r/../../etc',
    'o/r;rm',
    'o/r$(x)',
    'o r/x',
    '',
    'git@github.com:o/r.git',
    'https://github.com/o',
  ]) {
    assert.ok('erro' in parseOrigin(bad), `should refuse ${JSON.stringify(bad)}`)
  }
})
