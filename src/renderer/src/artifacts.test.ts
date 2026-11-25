import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artifactUrl, fenced, markdownImageSrc, resolveRelative } from './artifacts.ts'

test('artifactUrl encodes project id and each path segment', () => {
  assert.equal(artifactUrl('p 1', 'docs/a b.md'), 'brandy-art://p/p%201/docs/a%20b.md')
})

test('resolveRelative joins relative image sources to the file folder', () => {
  assert.equal(resolveRelative('docs', 'img/x.png'), 'docs/img/x.png')
  assert.equal(resolveRelative('docs', './x.png'), 'docs/x.png')
  assert.equal(resolveRelative('docs/sub', '../x.png'), 'docs/x.png')
  assert.equal(resolveRelative('', '../x.png'), null)
  assert.equal(resolveRelative('docs', 'https://x.com/a.png'), null)
  assert.equal(resolveRelative('docs', 'data:image/png;base64,AA'), null)
  assert.equal(resolveRelative('docs', '/abs.png'), null)
})

test('fenced picks a fence longer than any backtick run', () => {
  assert.equal(fenced('a', 'ts'), '```ts\na\n```')
  assert.equal(fenced('x ```` y'), '`````\nx ```` y\n`````')
})

test('resolveRelative returns null for a malformed escape instead of throwing', () => {
  assert.equal(resolveRelative('docs', 'img/%FF.png'), null)
  assert.equal(resolveRelative('docs', 'a%E0%A4.png'), null)
})

test('markdownImageSrc keeps images inside the project or on the web, blanks the rest', () => {
  assert.equal(markdownImageSrc('p', 'docs', 'img/x.png'), 'brandy-art://p/p/docs/img/x.png')
  assert.equal(markdownImageSrc('p', 'docs', 'https://x.com/a.png'), 'https://x.com/a.png')
  assert.equal(markdownImageSrc('p', 'docs', 'data:image/png;base64,AA'), 'data:image/png;base64,AA')
  assert.equal(markdownImageSrc('p', 'docs', '/tmp/x.png'), '')
  assert.equal(markdownImageSrc('p', 'docs', '../../../tmp/x.png'), '')
  assert.equal(markdownImageSrc('p', 'docs', 'file:///etc/x.png'), '')
  assert.equal(markdownImageSrc('p', 'docs', 'img/%FF.png'), '')
})
