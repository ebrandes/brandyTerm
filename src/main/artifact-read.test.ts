import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_ARTIFACT, artifactKind, readArtifact, resolveInside, textContentType } from './artifact-read.ts'

function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'brandy-art-')))
  const root = join(base, 'proj')
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'docs', 'a.md'), '# Olá')
  writeFileSync(join(base, 'outside.md'), 'segredo')
  symlinkSync(join(base, 'outside.md'), join(root, 'link.md'))
  return { base, root }
}

test('artifactKind picks the renderer by extension', () => {
  assert.equal(artifactKind('a/b.md').kind, 'md')
  assert.equal(artifactKind('a/b.markdown').kind, 'md')
  assert.equal(artifactKind('x.mmd').kind, 'mermaid')
  assert.equal(artifactKind('x.mermaid').kind, 'mermaid')
  assert.equal(artifactKind('x.HTML').kind, 'html')
  assert.equal(artifactKind('x.htm').kind, 'html')
  assert.equal(artifactKind('x.svg').kind, 'svg')
  assert.deepEqual(artifactKind('x.ts'), { kind: 'code', lang: 'ts' })
  assert.deepEqual(artifactKind('Makefile'), { kind: 'code', lang: undefined })
})

test('resolveInside refuses escapes, symlinks out and missing files', () => {
  const { root } = fixture()
  assert.equal(resolveInside(root, 'docs/a.md'), join(root, 'docs', 'a.md'))
  assert.equal(resolveInside(root, '../outside.md'), null)
  assert.equal(resolveInside(root, 'link.md'), null)
  assert.equal(resolveInside(root, 'nope.md'), null)
  assert.equal(resolveInside(root, ''), null)
  assert.equal(resolveInside(join(root, 'missing-root'), 'a.md'), null)
})

test('readArtifact reads, reports missing and too-big files', () => {
  const { root } = fixture()
  assert.deepEqual(readArtifact(root, 'docs/a.md'), { kind: 'md', text: '# Olá' })
  assert.deepEqual(readArtifact(root, 'gone.md'), { kind: 'missing' })
  assert.deepEqual(readArtifact(root, 'link.md'), { kind: 'missing' })
  writeFileSync(join(root, 'big.txt'), Buffer.alloc(MAX_ARTIFACT + 1))
  assert.deepEqual(readArtifact(root, 'big.txt'), { kind: 'too-big', size: 2097153 })
})

test('textContentType declares utf-8 for text artifacts served to the iframe', () => {
  assert.equal(textContentType('a/p.html'), 'text/html; charset=utf-8')
  assert.equal(textContentType('p.HTM'), 'text/html; charset=utf-8')
  assert.equal(textContentType('x.svg'), 'image/svg+xml; charset=utf-8')
  assert.equal(textContentType('x.png'), null)
})
